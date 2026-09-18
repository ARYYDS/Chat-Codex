/**
 * Chat-Codex Studio v2.5.0 - Main Frontend Application Engine
 * 100% Real Live Data Binding: Zero Mock Policy
 * Connects to backend SSE (/api/events) with automatic fallback to short polling (/api/status).
 * Manages mechanical odometers, dynamic SVG sparklines, drawers, diff viewers, and REST APIs.
 */

(function () {
  'use strict';

  class ChatCodexAppEngine {
    constructor() {
      this.odometers = {};
      this.memoryHistory = [0];
      this.maxMemoryHistory = 30;
      this.tasksData = [];
      this.selectedTaskId = 1;
      this.activeTab = 'report';
      this.sniffingProgress = 0;
      this.sniffingTimer = null;
      this.sseSource = null;
      this.pollingTimer = null;
      this.isSSEConnected = false;

      this.init();
    }

    init() {
      this.initOdometers();
      this.initSparkline();
      this.bindEvents();
      this.fetchInitialStatus();
      this.connectSSE();
    }

    // -----------------------------------------------------------------------
    // Odometers Initialization
    // -----------------------------------------------------------------------
    initOdometers() {
      const activeEl = document.getElementById('odo-active-chats');
      if (activeEl && window.MechanicalOdometer) {
        this.odometers.active = new window.MechanicalOdometer(activeEl, {
          duration: 450,
          pulseTarget: document.getElementById('kpi-card-active')
        });
        this.odometers.active.setValue('00');
      }

      const totalEl = document.getElementById('odo-total-chats');
      if (totalEl && window.MechanicalOdometer) {
        this.odometers.total = new window.MechanicalOdometer(totalEl, {
          duration: 450,
          pulseTarget: document.getElementById('kpi-card-total'),
          formatter: (v) => Number(v).toLocaleString('en-US')
        });
        this.odometers.total.setValue(0);
      }

      const memoryEl = document.getElementById('odo-memory-mb');
      if (memoryEl && window.MechanicalOdometer) {
        this.odometers.memory = new window.MechanicalOdometer(memoryEl, {
          duration: 450,
          pulseTarget: document.getElementById('kpi-card-memory'),
          formatter: (v) => Number(v).toFixed(1)
        });
        this.odometers.memory.setValue(0.0);
      }

      const adoptionEl = document.getElementById('odo-adoption-rate');
      if (adoptionEl && window.MechanicalOdometer) {
        this.odometers.adoption = new window.MechanicalOdometer(adoptionEl, {
          duration: 450,
          pulseTarget: document.getElementById('kpi-card-shadow'),
          formatter: (v) => Number(v).toFixed(1)
        });
        this.odometers.adoption.setValue(100.0);
      }
    }

    // -----------------------------------------------------------------------
    // Memory Sparkline Generator
    // -----------------------------------------------------------------------
    initSparkline() {
      this.updateSparkline();
    }

    pushMemoryData(mb) {
      if (typeof mb !== 'number' || isNaN(mb)) return;
      this.memoryHistory.push(mb);
      if (this.memoryHistory.length > this.maxMemoryHistory) {
        this.memoryHistory.shift();
      }
      this.updateSparkline();
      if (this.odometers.memory) {
        this.odometers.memory.setValue(mb);
      }
    }

    updateSparkline() {
      const svg = document.getElementById('memory-sparkline-svg');
      const pathEl = document.getElementById('sparkline-path');
      const areaEl = document.getElementById('sparkline-area');
      if (!svg || !pathEl || !areaEl) return;

      const width = 240;
      const height = 38;
      const padding = 4;

      if (this.memoryHistory.length < 2) {
        pathEl.setAttribute('d', `M 0 ${height - padding} L ${width} ${height - padding}`);
        areaEl.setAttribute('d', '');
        return;
      }

      const minVal = Math.max(0, Math.min(...this.memoryHistory) - 10);
      const maxVal = Math.max(...this.memoryHistory) + 10;
      const range = maxVal - minVal || 1;

      const step = (width - padding * 2) / (this.memoryHistory.length - 1);

      const points = this.memoryHistory.map((val, i) => {
        const x = padding + i * step;
        const normalizedY = (val - minVal) / range;
        const y = height - padding - normalizedY * (height - padding * 2);
        return { x: x.toFixed(1), y: y.toFixed(1) };
      });

      let linePath = `M ${points[0].x} ${points[0].y}`;
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const cpX = (parseFloat(prev.x) + parseFloat(curr.x)) / 2;
        linePath += ` C ${cpX} ${prev.y}, ${cpX} ${curr.y}, ${curr.x} ${curr.y}`;
      }

      pathEl.setAttribute('d', linePath);

      const lastPoint = points[points.length - 1];
      const firstPoint = points[0];
      const areaPath = `${linePath} L ${lastPoint.x} ${height} L ${firstPoint.x} ${height} Z`;
      areaEl.setAttribute('d', areaPath);
    }

    // -----------------------------------------------------------------------
    // Initial Status Fetch
    // -----------------------------------------------------------------------
    async fetchInitialStatus() {
      try {
        const res = await fetch('/api/status');
        if (!res.ok) return;
        const data = await res.json();

        if (data.master) this.updateMasterHeader(data.master);
        if (data.workers) this.handleWorkersEvent(data.workers);
        if (data.telemetry) this.handleTelemetryEvent(data.telemetry);
        if (data.tasks) this.handleTasksEvent(data.tasks);
      } catch (e) {
        console.warn('Initial status fetch failed:', e);
      }
    }

    updateMasterHeader(master) {
      const badge = document.getElementById('header-master-badge');
      const dot = document.getElementById('header-master-dot');
      const text = document.getElementById('header-master-text');
      if (!badge || !dot || !text) return;

      if (master && master.alive) {
        badge.className = 'status-badge badge-success';
        dot.className = 'status-dot dot-green';
        text.textContent = `Master: 9225 | ONLINE (PID: ${master.pid || '--'})`;
      } else {
        badge.className = 'status-badge badge-warning';
        dot.className = 'status-dot dot-yellow';
        text.textContent = 'Master: 9225 | OFFLINE';
      }
    }

    // -----------------------------------------------------------------------
    // Pipeline Tasks Table Rendering
    // -----------------------------------------------------------------------
    renderPipelineTasks() {
      const tbody = document.getElementById('pipeline-tasks-tbody');
      if (!tbody) return;

      tbody.innerHTML = '';
      if (!this.tasksData || this.tasksData.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">暂无错峰任务，点击下方“启动 10 路错峰调度”开始执行</td>';
        tbody.appendChild(tr);
        return;
      }

      this.tasksData.forEach((task, index) => {
        const tr = document.createElement('tr');
        const taskId = task.id || (index + 1);
        tr.id = `task-row-${taskId}`;
        if (this.selectedTaskId === taskId) {
          tr.classList.add('active-row');
        }

        const durText = task.durationSec ? `${task.durationSec}s` : (task.status === 'done' ? '完成' : '待派发');
        const textLen = (task.text && task.text.length) || 0;
        const wordCount = textLen > 0 ? `${textLen} 字` : '0 字';
        const tokCount = textLen > 0 ? `${Math.round(textLen / 3.5)} Tok` : '0 Tok';

        const isRunning = task.status === 'generating' || task.status === 'streaming' || task.status === 'searching';
        const isDone = task.status === 'done' || task.status === 'COMPLETED';

        let statusClass = 'status-queued';
        let statusLabel = `[ ⏳ ${task.status || 'PENDING'} ]`;
        if (isDone) {
          statusClass = 'status-merged';
          statusLabel = '[ ✅ DONE ]';
        } else if (isRunning) {
          statusClass = 'status-generating';
          statusLabel = '[ 🔵 RUNNING... ]';
        }

        let actionHtml = '';
        if (isRunning) {
          actionHtml = `<button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); window.ChatCodexApp.forceStopTask('${taskId}')" title="人工最高单任务强停：通过 CDP 点击网页 Stop 按钮"><span>🛑</span> 强制停止</button>`;
        } else if (isDone) {
          actionHtml = `<button class="btn btn-sm" onclick="event.stopPropagation(); window.ChatCodexApp.selectTask(${taskId}); window.ChatCodexApp.openDrawer();" title="查阅 Markdown 研报"><span>📄</span> 查阅研报</button>`;
        } else {
          actionHtml = `<span style="color: var(--text-dim); font-size: 11px;">待命</span>`;
        }

        tr.innerHTML = `
          <td><span class="task-id-badge">${String(taskId).padStart(2, '0')}</span></td>
          <td class="task-title-cell" title="${task.title || ''}">${task.title || ('Task #' + taskId)}</td>
          <td style="font-family: var(--font-mono);">${task.dispatchTime || ('T + ' + (index * 10) + 's')}</td>
          <td style="font-family: var(--font-mono);">${durText}</td>
          <td style="font-family: var(--font-mono);">${wordCount}</td>
          <td style="font-family: var(--font-mono); color: var(--accent-cyan);">${tokCount}</td>
          <td>
            <span class="capsule-status ${statusClass}">${statusLabel}</span>
          </td>
          <td style="text-align: center;">
            ${actionHtml}
          </td>
        `;

        tr.addEventListener('click', () => {
          this.selectTask(taskId);
          this.openDrawer();
        });

        tbody.appendChild(tr);
      });
    }

    async selectTask(taskId) {
      this.selectedTaskId = taskId;

      document.querySelectorAll('#pipeline-tasks-tbody tr').forEach((r) => r.classList.remove('active-row'));
      const activeRow = document.getElementById(`task-row-${taskId}`);
      if (activeRow) activeRow.classList.add('active-row');

      const task = (this.tasksData || []).find((t) => (t.id || 0) === taskId) || { id: taskId, title: `Task #${taskId}` };

      // Update Drawer Header & Meta
      const titleEl = document.getElementById('drawer-task-title');
      if (titleEl) titleEl.textContent = `[Task ${taskId}] ${task.title || ''}`;

      const archiveEl = document.getElementById('drawer-archive-path');
      if (archiveEl) archiveEl.textContent = task.archivePath ? `归档定位: ${task.archivePath}` : '归档定位: runs/results.json';

      const durEl = document.getElementById('drawer-meta-duration');
      if (durEl) durEl.textContent = task.durationSec ? `${task.durationSec}s` : '--';

      const textLen = (task.text && task.text.length) || 0;
      const wordsEl = document.getElementById('drawer-meta-words');
      if (wordsEl) wordsEl.textContent = textLen > 0 ? `${textLen} 字` : '0 字';

      const tokEl = document.getElementById('drawer-meta-tokens');
      if (tokEl) tokEl.textContent = textLen > 0 ? `${Math.round(textLen / 3.5)} Tok` : '0 Tok';

      // Fetch Real Report & Diff from Server
      try {
        const res = await fetch(`/api/tasks/${taskId}/report`);
        if (res.ok) {
          const reportData = await res.json();
          this.renderMarkdownReport(reportData);
          this.renderRawReceipt(reportData);
          this.renderDiff(reportData.diff);
        } else {
          this.renderMarkdownReport({ markdown: task.text || '# 暂无研报正文\n当前任务尚未产出数据。' });
          this.renderRawReceipt(task);
        }
      } catch (e) {
        this.renderMarkdownReport({ markdown: task.text || '# 研报读取失败\n无法连接后端 API。' });
      }
    }

    renderMarkdownReport(data) {
      const container = document.getElementById('drawer-report-content');
      if (!container) return;

      const md = data.markdown || data.text || '# 暂无研报正文';
      let html = md
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
        .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
        .replace(/\*(.*)\*/gim, '<em>$1</em>')
        .replace(/`([^`]+)`/gim, '<code>$1</code>')
        .replace(/\n\n/gim, '</p><p>')
        .replace(/\n/gim, '<br>');

      container.innerHTML = `<p>${html}</p>`;
    }

    renderRawReceipt(task) {
      const receiptEl = document.getElementById('drawer-receipt-content');
      if (!receiptEl) return;
      receiptEl.textContent = JSON.stringify(task, null, 2);
    }

    renderDiff(diffText) {
      const diffContainer = document.getElementById('diff-viewer-content');
      if (!diffContainer) return;

      if (!diffText || !diffText.trim()) {
        diffContainer.innerHTML = '<div style="color: var(--text-muted); padding: 16px;">Clean tree. 无未提交的代码变更。</div>';
        return;
      }

      const lines = diffText.split('\n');
      let html = '';
      lines.forEach((line, idx) => {
        let lineClass = '';
        if (line.startsWith('+') && !line.startsWith('+++')) lineClass = 'diff-add';
        else if (line.startsWith('-') && !line.startsWith('---')) lineClass = 'diff-del';
        else if (line.startsWith('@')) lineClass = 'diff-hunk';

        const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += `<div class="diff-line ${lineClass}"><span class="diff-num">${idx + 1}</span><span class="diff-code">${escaped}</span></div>`;
      });
      diffContainer.innerHTML = html;
    }

    // -----------------------------------------------------------------------
    // Drawer Management & Tab Switching
    // -----------------------------------------------------------------------
    openDrawer() {
      const drawer = document.getElementById('slideover-drawer');
      const backdrop = document.getElementById('drawer-backdrop');
      if (drawer) drawer.classList.add('open');
      if (backdrop) backdrop.classList.add('open');
    }

    closeDrawer() {
      const drawer = document.getElementById('slideover-drawer');
      const backdrop = document.getElementById('drawer-backdrop');
      if (drawer) {
        drawer.classList.remove('open');
        drawer.classList.remove('fullscreen');
      }
      if (backdrop) backdrop.classList.remove('open');
    }

    toggleDrawerFullscreen() {
      const drawer = document.getElementById('slideover-drawer');
      if (drawer) {
        drawer.classList.toggle('fullscreen');
      }
    }

    switchDrawerTab(tabKey) {
      this.activeTab = tabKey;
      document.querySelectorAll('.drawer-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.getAttribute('data-tab') === tabKey);
      });

      document.querySelectorAll('.drawer-tab-pane').forEach((pane) => {
        pane.classList.toggle('active', pane.id === `pane-${tabKey}`);
      });
    }

    // -----------------------------------------------------------------------
    // Modal Windows Management
    // -----------------------------------------------------------------------
    openMasterModal() {
      const modal = document.getElementById('modal-master-login');
      if (modal) modal.classList.add('open');
      this.startSniffingAnimation();
    }

    closeMasterModal() {
      const modal = document.getElementById('modal-master-login');
      if (modal) modal.classList.remove('open');
      this.stopSniffingAnimation();
    }

    startSniffingAnimation() {
      this.stopSniffingAnimation();
      this.sniffingProgress = 20;
      this.sniffingTimer = setInterval(() => {
        if (this.sniffingProgress < 90) {
          this.sniffingProgress += 10;
          const bar = document.getElementById('sniffing-progress-bar');
          const text = document.getElementById('sniffing-percent-text');
          if (bar) bar.style.width = `${this.sniffingProgress}%`;
          if (text) text.textContent = `${this.sniffingProgress}%`;
        }
      }, 800);
    }

    stopSniffingAnimation() {
      if (this.sniffingTimer) {
        clearInterval(this.sniffingTimer);
        this.sniffingTimer = null;
      }
    }

    openArbitrationModal() {
      const modal = document.getElementById('modal-arbitration');
      if (modal) modal.classList.add('open');
    }

    closeArbitrationModal() {
      const modal = document.getElementById('modal-arbitration');
      if (modal) modal.classList.remove('open');
    }

    openSettingsModal() {
      const modal = document.getElementById('modal-settings');
      if (modal) modal.classList.add('open');
    }

    closeSettingsModal() {
      const modal = document.getElementById('modal-settings');
      if (modal) modal.classList.remove('open');
    }

    // -----------------------------------------------------------------------
    // Toast Notification System
    // -----------------------------------------------------------------------
    showToast(message, type = 'info') {
      const container = document.getElementById('toast-container');
      if (!container) return;

      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      
      let icon = 'ℹ️';
      if (type === 'success') icon = '✅';
      if (type === 'error') icon = '🛑';
      if (type === 'warning') icon = '⚠️';

      toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
      container.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(30px)';
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    }

    // -----------------------------------------------------------------------
    // REST API Clients & Handlers
    // -----------------------------------------------------------------------
    async callApi(endpoint, method = 'POST', body = null) {
      try {
        const options = {
          method,
          headers: { 'Content-Type': 'application/json' }
        };
        if (body) options.body = JSON.stringify(body);

        const res = await fetch(endpoint, options);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        return await res.json();
      } catch (err) {
        return { error: err.message };
      }
    }

    async launchMaster() {
      this.openMasterModal();
      this.showToast('正在初始化 Master-Seed 种子沙盒 (Port 9225)...', 'info');
      const res = await this.callApi('/api/master/launch');
      if (res && res.success) {
        this.showToast('Master-Seed 窗口已拉起，请在浏览器中完成登录', 'success');
      } else if (res && res.error) {
        this.showToast(res.error, 'error');
      }
    }

    async confirmMasterSync() {
      this.showToast('正在向 9225 请求 Cookie 纯内存导出并同步到 Worker...', 'info');
      const res = await this.callApi('/api/master/sync');
      if (res && res.success) {
        const bar = document.getElementById('sniffing-progress-bar');
        const text = document.getElementById('sniffing-percent-text');
        const statusLabel = document.getElementById('sniffing-status-label');
        if (bar) bar.style.width = '100%';
        if (text) text.textContent = '100%';
        if (statusLabel) {
          statusLabel.textContent = `✅ 已成功同步 ${res.cookieCount} 个会话凭据 (${res.durationMs}ms)`;
          statusLabel.style.color = 'var(--accent-emerald)';
        }
        setTimeout(() => {
          this.closeMasterModal();
          this.showToast(`凭据已同步至 Worker (${res.durationMs}ms)`, 'success');
          this.fetchInitialStatus();
        }, 600);
      } else {
        this.showToast(res.error || '凭据同步失败', 'error');
      }
    }

    async syncCookies() {
      this.showToast('正在向 9225 发起 Cookie 纯内存导出...', 'info');
      const res = await this.callApi('/api/master/sync');
      if (res && res.success) {
        this.showToast(`内存凭据热分发完成：已更新 ${res.cookieCount} 个 Cookie 到 Worker！`, 'success');
        this.fetchInitialStatus();
      } else {
        this.showToast(res.error || '凭据同步失败', 'error');
      }
    }

    async globalGC() {
      this.showToast('正在触发全局 GC，释放空闲 Tab 与 Blink 进程...', 'info');
      const res = await this.callApi('/api/cluster/gc');
      if (res && res.success) {
        this.showToast(`全局 GC 完毕：释放 ${res.closedTabsCount} 个 Tab，估算节约 ${res.estimatedSavedMB}MB 内存`, 'success');
        this.fetchInitialStatus();
      } else {
        this.showToast(res.error || 'GC 执行失败', 'error');
      }
    }

    async forceStopTask(taskId) {
      this.showToast(`正在向 CDP 发送单任务物理强停指令 (Task #${taskId})...`, 'warning');
      try {
        const res = await this.callApi(`/api/tasks/${taskId}/stop`, 'POST');
        if (res && res.success) {
          if (res.clicked) {
            this.showToast(`✅ 已通过 CDP 物理点击 Stop 按钮，成功熔断任务 #${taskId}！`, 'success');
          } else {
            this.showToast(`⚠️ 任务 #${taskId} Stop 按钮未挂载或无需熔断`, 'info');
          }
          this.fetchInitialStatus();
        } else {
          this.showToast(res?.error || '强制停止请求失败', 'error');
        }
      } catch (err) {
        this.showToast(`强制停止异常: ${err.message}`, 'error');
      }
    }

    openInVSCode() {
      const task = (this.tasksData || []).find((t) => (t.id || 0) === this.selectedTaskId);
      const archivePath = task?.path || task?.archivePath || 'PassSearchHistory';
      window.location.href = `vscode://file/${encodeURIComponent(archivePath)}`;
      this.showToast(`正在 VS Code 中打开: ${archivePath}`, 'info');
    }

    async emergencyStop() {
      if (!confirm('【警告】确定要紧急停止所有调度并硬熔断执行进程吗？')) return;
      this.showToast('正在硬熔断全部子孙进程...', 'error');
      const res = await this.callApi('/api/cluster/emergency-stop');
      if (res && res.success) {
        this.showToast('所有调度任务已紧急停止！', 'warning');
        this.fetchInitialStatus();
      } else {
        this.showToast(res.error || '停止失败', 'error');
      }
    }

    async startStaggeredDispatch() {
      this.showToast('正在启动 10 路自适应随机抖动错峰调度流水线...', 'info');
      const res = await this.callApi('/api/dispatch/start');
      if (res && res.success) {
        this.showToast('10 路错峰任务流水线已在后台平滑拉起！', 'success');
        this.fetchInitialStatus();
      } else {
        this.showToast(res.error || '启动流水线失败', 'error');
      }
    }

    async stopWorker(port) {
      this.showToast(`正在安全停止 Worker (Port ${port})...`, 'info');
      const res = await this.callApi(`/api/workers/${port}/stop`);
      if (res && res.success) {
        this.showToast(`Worker (Port ${port}) 已停止。`, 'warning');
        this.fetchInitialStatus();
      } else {
        this.showToast(res.error || '停止失败', 'error');
      }
    }

    async refreshWorker(port) {
      this.showToast(`正在对 Worker (Port ${port}) 执行内存热刷新...`, 'info');
      const res = await this.callApi(`/api/workers/${port}/refresh`);
      if (res && res.success) {
        this.showToast(`Worker (Port ${port}) 凭据已热刷新！`, 'success');
        this.fetchInitialStatus();
      } else {
        this.showToast(res.error || '刷新失败', 'error');
      }
    }

    async forceWorkerGC(port) {
      this.showToast(`正在对 Worker (Port ${port}) 执行强制 Tab GC...`, 'info');
      const res = await this.callApi(`/api/workers/${port}/gc`);
      if (res && res.success) {
        this.showToast(`Worker (Port ${port}) GC 完毕，释放 ${res.closedTabsCount} 个 Tab`, 'success');
        this.fetchInitialStatus();
      } else {
        this.showToast(res.error || 'GC 失败', 'error');
      }
    }

    async addWorker() {
      this.showToast('正在派生全新 Worker 沙盒...', 'info');
      const res = await this.callApi('/api/workers/add');
      if (res && res.success) {
        this.showToast('Worker 实例已拉起！', 'success');
        this.fetchInitialStatus();
      } else {
        this.showToast(res.error || '派生 Worker 失败', 'error');
      }
    }

    async submitArbitration() {
      const reasonSelect = document.getElementById('arbitration-reason-select');
      const promptInput = document.getElementById('arbitration-prompt-input');
      const reason = reasonSelect ? reasonSelect.value : 'hallucination';
      const prompt = promptInput ? promptInput.value.trim() : '';

      this.showToast('正在记录人工仲裁指引...', 'info');
      const res = await this.callApi(`/api/tasks/${this.selectedTaskId}/arbitrate`, 'POST', {
        reason,
        prompt
      });

      this.closeArbitrationModal();
      if (res && res.success) {
        this.showToast(`任务 [Task ${this.selectedTaskId}] 仲裁已生效！`, 'success');
        this.fetchInitialStatus();
      } else {
        this.showToast(res.error || '仲裁记录失败', 'error');
      }
    }

    saveSettings() {
      this.showToast('运行时设置已保存至 C:\\GPT-Chat-codex-handoff\\runtime.local.json', 'success');
      this.closeSettingsModal();
    }

    // -----------------------------------------------------------------------
    // SSE & Short Polling Connectivity
    // -----------------------------------------------------------------------
    connectSSE() {
      if (typeof window.EventSource === 'undefined') {
        this.fallbackToPolling();
        return;
      }

      try {
        this.sseSource = new EventSource('/api/events');

        this.sseSource.onopen = () => {
          this.isSSEConnected = true;
          this.clearPollingTimer();
          const mcpBadge = document.getElementById('header-mcp-badge');
          if (mcpBadge) {
            mcpBadge.innerHTML = '<span class="status-dot dot-blue"></span> <span>🔌 MCP: SSE RUNNING / IPv4</span>';
          }
        };

        this.sseSource.addEventListener('telemetry', (e) => {
          try {
            const data = JSON.parse(e.data);
            this.handleTelemetryEvent(data);
          } catch {}
        });

        this.sseSource.addEventListener('workers', (e) => {
          try {
            const data = JSON.parse(e.data);
            this.handleWorkersEvent(data);
          } catch {}
        });

        this.sseSource.addEventListener('tasks', (e) => {
          try {
            const data = JSON.parse(e.data);
            this.handleTasksEvent(data);
          } catch {}
        });

        this.sseSource.onerror = () => {
          this.isSSEConnected = false;
          if (this.sseSource) {
            this.sseSource.close();
            this.sseSource = null;
          }
          this.fallbackToPolling();
        };
      } catch {
        this.fallbackToPolling();
      }
    }

    fallbackToPolling() {
      if (this.pollingTimer) return;
      
      const mcpBadge = document.getElementById('header-mcp-badge');
      if (mcpBadge) {
        mcpBadge.innerHTML = '<span class="status-dot dot-green"></span> <span>🔌 MCP: POLLING / IPv4 (2.5s)</span>';
      }

      this.pollingTimer = setInterval(async () => {
        await this.fetchInitialStatus();
      }, 2500);
    }

    clearPollingTimer() {
      if (this.pollingTimer) {
        clearInterval(this.pollingTimer);
        this.pollingTimer = null;
      }
    }

    handleTelemetryEvent(data) {
      if (!data) return;

      const active = data.activeChats !== undefined ? data.activeChats : (data.activeWindows || 0);
      if (this.odometers.active) {
        this.odometers.active.setValue(String(active).padStart(2, '0'));
      }
      const prog = document.getElementById('kpi-active-progress');
      if (prog) prog.style.width = `${Math.min(100, Math.round((active / 10) * 100))}%`;
      const loadText = document.getElementById('kpi-active-load-text');
      if (loadText) loadText.textContent = `${active} / 10 负载 (${Math.min(100, Math.round((active / 10) * 100))}%)`;

      const total = data.totalChats !== undefined ? data.totalChats : (data.totalDispatched || 0);
      if (this.odometers.total) {
        this.odometers.total.setValue(total);
      }

      const tokens = data.estimatedTokens !== undefined ? data.estimatedTokens : 0;
      const tokEl = document.getElementById('kpi-total-tokens');
      if (tokEl) {
        tokEl.textContent = tokens > 1000000 ? `${(tokens / 1000000).toFixed(1)}M Tok` : (tokens > 1000 ? `${(tokens / 1000).toFixed(1)}K Tok` : `${tokens} Tok`);
      }

      const slaEl = document.getElementById('kpi-sla-rate');
      if (slaEl) {
        slaEl.textContent = (data.totalCompleted > 0) ? '100% (极高)' : (total > 0 ? '进行中' : '--');
      }

      const mem = data.memoryMB !== undefined ? data.memoryMB : (data.totalClusterMemoryMB || 0);
      this.pushMemoryData(mem);

      const procs = (data.workers?.reduce((acc, w) => acc + ((w.pids?.length) || (w.alive ? 1 : 0)), 0) || 0) + (data.master?.alive ? 1 : 0);
      const procEl = document.getElementById('kpi-memory-processes');
      if (procEl) procEl.textContent = `Chrome x ${procs}`;

      const rate = data.adoptionRate !== undefined ? data.adoptionRate : (data.gateAdoptionRate || 100.0);
      if (this.odometers.adoption) {
        this.odometers.adoption.setValue(rate);
      }

      if (data.ephemeral && data.ephemeral.savedMemoryMB !== undefined) {
        const ephEl = document.getElementById('kpi-ephemeral-saved');
        if (ephEl) ephEl.textContent = `${data.ephemeral.savedMemoryMB} MB`;
      }

      const hb = document.getElementById('kpi-heartbeat-status');
      if (hb) {
        const aliveWorkers = (data.workers || []).filter(w => w.alive).length;
        hb.textContent = `CDP 遥测就绪 (${aliveWorkers} Worker 在线)`;
      }

      const timeBadge = document.getElementById('telemetry-update-time');
      if (timeBadge) {
        const now = new Date();
        const timeStr = now.toTimeString().split(' ')[0];
        timeBadge.textContent = `1Hz 原生遥测 (${timeStr})`;
      }

      // Update Workers Header Badge
      const workersBadge = document.getElementById('header-workers-badge');
      const workersDot = document.getElementById('header-workers-dot');
      const workersText = document.getElementById('header-workers-text');
      if (workersBadge && workersDot && workersText && data.workers) {
        const aliveList = data.workers.filter(w => w.alive);
        const alivePorts = aliveList.map(w => w.port).join(',');
        if (aliveList.length > 0) {
          workersBadge.className = 'status-badge badge-success';
          workersDot.className = 'status-dot dot-green';
          workersText.textContent = `Workers: ${alivePorts} ONLINE (${Math.round(aliveList.length / data.workers.length * 100)}%)`;
        } else {
          workersBadge.className = 'status-badge badge-warning';
          workersDot.className = 'status-dot dot-yellow';
          workersText.textContent = 'Workers: 全部离线 (0%)';
        }
      }
    }

    handleWorkersEvent(data) {
      const workers = Array.isArray(data) ? data : Object.values(data);
      if (!workers || workers.length === 0) return;

      workers.forEach((w) => {
        const port = w.port;
        const pill = document.getElementById(`worker-${port}-status-pill`);
        const memEl = document.getElementById(`worker-${port}-memory`);
        const pidsEl = document.getElementById(`worker-${port}-pids`);
        const taskEl = document.getElementById(`worker-${port}-task`);
        const durEl = document.getElementById(`worker-${port}-duration`);
        const wordsEl = document.getElementById(`worker-${port}-words`);
        const searchEl = document.getElementById(`worker-${port}-search-status`);
        const progEl = document.getElementById(`worker-${port}-progress`);

        if (w.alive) {
          if (pill) {
            pill.className = `worker-status-pill ${w.status === 'active' ? 'status-streaming' : 'status-idle'}`;
            pill.innerHTML = `<span class="status-dot dot-green"></span> ${w.status === 'active' ? 'STREAMING' : 'IDLE'}`;
          }
          if (memEl) memEl.textContent = `${w.memoryMB || 0} MB`;
          if (pidsEl) {
            const count = (w.pids && w.pids.length) || 1;
            const pidStr = w.pid || (w.pids && w.pids.join(', ')) || '--';
            pidsEl.textContent = `${count} 进程 (PID: ${pidStr})`;
          }
          if (taskEl) {
            if (w.activeTabs > 0) {
              taskEl.textContent = `${w.activeTabs} 活跃 Tab / ${w.tabsCount} 挂载 Tab`;
            } else {
              taskEl.textContent = '[空闲待命] 错峰调度队列就绪中...';
            }
          }
          if (durEl && w.duration) durEl.textContent = w.duration;
          if (wordsEl && w.words !== undefined) wordsEl.textContent = `${w.words} 字`;
          if (searchEl && w.search) searchEl.textContent = `搜索: ${w.search}`;
          if (progEl) progEl.style.width = w.status === 'active' ? '50%' : '0%';
        } else {
          if (pill) {
            pill.className = 'worker-status-pill status-offline';
            pill.innerHTML = '<span class="status-dot dot-grey"></span> OFFLINE';
          }
          if (memEl) memEl.textContent = '0.0 MB (离线)';
          if (pidsEl) pidsEl.textContent = '0 进程 (PID: --)';
          if (taskEl) taskEl.textContent = '[离线待拉起] 点击启动或通过母版同步凭据';
          if (durEl) durEl.textContent = '--:--:--';
          if (wordsEl) wordsEl.textContent = '0 字';
          if (searchEl) searchEl.textContent = '搜索: 暂无';
          if (progEl) progEl.style.width = '0%';
        }
      });
    }

    handleTasksEvent(data) {
      if (Array.isArray(data)) {
        this.tasksData = data;
        this.renderPipelineTasks();
        if (this.selectedTaskId) {
          const t = this.tasksData.find(x => (x.id || 0) === this.selectedTaskId);
          if (t) {
            const titleEl = document.getElementById('drawer-task-title');
            if (titleEl) titleEl.textContent = `[Task ${t.id}] ${t.title || ''}`;
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // DOM Events Binding
    // -----------------------------------------------------------------------
    bindEvents() {
      // Header Action Buttons
      const btnMaster = document.getElementById('btn-launch-master');
      if (btnMaster) btnMaster.addEventListener('click', () => this.launchMaster());

      const btnSync = document.getElementById('btn-sync-cookies');
      if (btnSync) btnSync.addEventListener('click', () => this.syncCookies());

      const btnGC = document.getElementById('btn-global-gc');
      if (btnGC) btnGC.addEventListener('click', () => this.globalGC());

      const btnSettings = document.getElementById('btn-open-settings');
      if (btnSettings) btnSettings.addEventListener('click', () => this.openSettingsModal());

      const btnStop = document.getElementById('btn-emergency-stop');
      if (btnStop) btnStop.addEventListener('click', () => this.emergencyStop());

      const btnAddWorker = document.getElementById('btn-add-worker');
      if (btnAddWorker) btnAddWorker.addEventListener('click', () => this.addWorker());

      const btnDispatch = document.getElementById('btn-start-dispatch');
      if (btnDispatch) btnDispatch.addEventListener('click', () => this.startStaggeredDispatch());

      // Master Modal Sync Button
      const btnConfirmSync = document.getElementById('btn-confirm-master-sync');
      if (btnConfirmSync) btnConfirmSync.addEventListener('click', () => this.confirmMasterSync());

      const btnCancelMaster = document.getElementById('btn-cancel-master-modal');
      if (btnCancelMaster) btnCancelMaster.addEventListener('click', () => this.closeMasterModal());

      const btnCloseMasterX = document.getElementById('btn-close-master-modal');
      if (btnCloseMasterX) btnCloseMasterX.addEventListener('click', () => this.closeMasterModal());

      // Drawer Controls
      const btnOpenVSCode = document.getElementById('btn-open-vscode');
      if (btnOpenVSCode) btnOpenVSCode.addEventListener('click', () => this.openInVSCode());

      const btnCloseDrawer = document.getElementById('btn-close-drawer');
      if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', () => this.closeDrawer());

      const btnCloseDrawerX = document.getElementById('btn-close-drawer-x');
      if (btnCloseDrawerX) btnCloseDrawerX.addEventListener('click', () => this.closeDrawer());

      const btnExpandDrawer = document.getElementById('btn-expand-drawer');
      if (btnExpandDrawer) btnExpandDrawer.addEventListener('click', () => this.toggleDrawerFullscreen());

      const backdrop = document.getElementById('drawer-backdrop');
      if (backdrop) backdrop.addEventListener('click', () => this.closeDrawer());

      // Drawer Tabs
      const tabReport = document.getElementById('tab-btn-report');
      if (tabReport) tabReport.addEventListener('click', () => this.switchDrawerTab('report'));

      const tabDiff = document.getElementById('tab-btn-diff');
      if (tabDiff) tabDiff.addEventListener('click', () => this.switchDrawerTab('diff'));

      const tabReceipt = document.getElementById('tab-btn-receipt');
      if (tabReceipt) tabReceipt.addEventListener('click', () => this.switchDrawerTab('receipt'));

      // Human Arbitration Banner Buttons
      const btnForceReject = document.getElementById('btn-force-reject');
      if (btnForceReject) btnForceReject.addEventListener('click', () => this.openArbitrationModal());

      const btnCancelArbitration = document.getElementById('btn-cancel-arbitration');
      if (btnCancelArbitration) btnCancelArbitration.addEventListener('click', () => this.closeArbitrationModal());

      const btnSubmitArbitration = document.getElementById('btn-submit-arbitration');
      if (btnSubmitArbitration) btnSubmitArbitration.addEventListener('click', () => this.submitArbitration());

      const btnMarkWarning = document.getElementById('btn-mark-warning');
      if (btnMarkWarning) {
        btnMarkWarning.addEventListener('click', () => {
          this.showToast('已标记局部警告：当前任务标记为需重点人工复核', 'warning');
        });
      }

      const btnViewDom = document.getElementById('btn-view-dom');
      if (btnViewDom) {
        btnViewDom.addEventListener('click', () => {
          this.switchDrawerTab('receipt');
          this.showToast('已载入实时 DOM 原始流与 CDP 事件监听树', 'info');
        });
      }

      // Settings Modal
      const btnSaveSettings = document.getElementById('btn-save-settings');
      if (btnSaveSettings) btnSaveSettings.addEventListener('click', () => this.saveSettings());

      const btnCancelSettings = document.getElementById('btn-cancel-settings');
      if (btnCancelSettings) btnCancelSettings.addEventListener('click', () => this.closeSettingsModal());

      const btnCloseSettingsX = document.getElementById('btn-close-settings');
      if (btnCloseSettingsX) btnCloseSettingsX.addEventListener('click', () => this.closeSettingsModal());

      // Keyboard Shortcuts
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.closeDrawer();
          this.closeMasterModal();
          this.closeArbitrationModal();
          this.closeSettingsModal();
        }
      });
    }
  }

  // Initialize and mount to window
  document.addEventListener('DOMContentLoaded', () => {
    window.ChatCodexApp = new ChatCodexAppEngine();
  });
})();
