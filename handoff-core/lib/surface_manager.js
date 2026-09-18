/**
 * Chat-Codex Surface Manager (Chat vs Work)
 * 
 * Provides deterministic detection, routing, and switching between ChatGPT's
 * two core operating surfaces:
 * 1. "chat" (Standard ChatGPT linear chat surface)
 * 2. "work" (TPP / Thought Partner Platform - Work workspace with Outputs & Sources)
 * 
 * Based on empirical reverse engineering of ChatGPT web:
 * - Home DOM: role="radiogroup" aria-label="Select chat surface"
 *   - button[data-tpp-toggle-value="chatgpt"]
 *   - button[data-tpp-toggle-value="work"]
 * - Conversation Header: contains "Work", "Outputs", and "Sources"
 * - Backend API: conversation_origin === 'tpp' (Work) vs null (Chat)
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.id = 1;
    this.callbacks = new Map();
  }
  async connect() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
    }
    this.callbacks.clear();
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else if (msg.result && msg.result.exceptionDetails) {
          reject(new Error(msg.result.exceptionDetails.exception?.description || 'Evaluation exception'));
        } else {
          if (msg.result && msg.result.result !== undefined && msg.result.result.value !== undefined) {
            resolve(msg.result.result.value);
          } else if (msg.result && msg.result.value !== undefined) {
            resolve(msg.result.value);
          } else {
            resolve(msg.result);
          }
        }
      }
    };
  }
  send(method, params = {}, sessionId = undefined) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    });
  }
  eval(expression, sessionId = undefined) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      const payload = {
        id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true }
      };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    });
  }
  close() {
    if (this.ws) this.ws.close();
  }
}

class FlatSessionClient {
  constructor(browserClient, sessionId, targetId) {
    this.browserClient = browserClient;
    this.sessionId = sessionId;
    this.targetId = targetId;
  }
  send(method, params = {}) {
    return this.browserClient.send(method, params, this.sessionId);
  }
  eval(expression) {
    return this.browserClient.eval(expression, this.sessionId);
  }
  async detach() {
    return this.browserClient.send('Target.detachFromTarget', { sessionId: this.sessionId }).catch(() => {});
  }
  close() {
    return this.detach();
  }
}

async function attachFlatSession(portOrBrowserWsUrl, targetId) {
  let wsUrl = portOrBrowserWsUrl;
  if (typeof portOrBrowserWsUrl === 'number' || /^\d+$/.test(String(portOrBrowserWsUrl))) {
    const port = Number(portOrBrowserWsUrl);
    const version = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/json/version`, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
    wsUrl = version.webSocketDebuggerUrl;
  }

  const browserClient = new CdpClient(wsUrl);
  await browserClient.connect();

  const attachRes = await browserClient.send('Target.attachToTarget', {
    targetId,
    flatten: true
  });
  const sessionId = attachRes && attachRes.sessionId ? attachRes.sessionId : (attachRes ? attachRes.value : null);
  return new FlatSessionClient(browserClient, sessionId, targetId);
}

async function getChatGPTTab(port = 9222) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/json/list`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const tabs = JSON.parse(data);
          const tab = tabs.find(t => t.type === 'page' && t.url.includes('chatgpt.com'));
          resolve(tab);
        } catch(e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Detect the current location and mode in the ChatGPT web interface.
 * @param {Object} cdpClient - Connected CDP client with eval(expression)
 * @returns {Promise<{ location: 'home'|'conversation', mode: 'chat'|'work'|'pending_hydration', conversationId: string|null, details: Object }>}
 */
async function detectSurface(cdpClient) {
  return await cdpClient.eval(`(() => {
    const url = window.location.href;
    const isConv = url.includes('/c/');
    const convIdMatch = url.match(/\\/c\\/([a-zA-Z0-9-]+)/);
    const convId = convIdMatch ? convIdMatch[1] : null;

    if (!isConv) {
      // Home screen: query the surface radio buttons
      const workBtn = document.querySelector('button[data-tpp-toggle-value="work"]');
      const chatBtn = document.querySelector('button[data-tpp-toggle-value="chatgpt"]');
      
      const isWork = workBtn && (workBtn.getAttribute('data-state') === 'on' || workBtn.getAttribute('aria-checked') === 'true');
      const isChat = chatBtn && (chatBtn.getAttribute('data-state') === 'on' || chatBtn.getAttribute('aria-checked') === 'true');
      
      return {
        location: 'home',
        mode: isWork ? 'work' : (isChat ? 'chat' : 'pending_hydration'),
        conversationId: null,
        details: {
          chatFound: !!chatBtn,
          workFound: !!workBtn,
          chatState: chatBtn?.getAttribute('data-state'),
          workState: workBtn?.getAttribute('data-state'),
          h1: document.querySelector('h1')?.innerText || null
        }
      };
    } else {
      // Inside conversation
      const header = document.querySelector('header');
      const headerText = header ? header.innerText : '';
      const hasWorkBadge = headerText.includes('Work');
      const hasOutputsBtn = Array.from(document.querySelectorAll('header button, header a')).some(b => (b.innerText || '').includes('Outputs'));
      const hasSourcesBtn = Array.from(document.querySelectorAll('header button, header a')).some(b => (b.innerText || '').includes('Sources'));
      
      const sidebarItem = convId ? document.querySelector('a[href="/c/' + convId + '"]') : null;
      const sidebarAria = sidebarItem ? sidebarItem.getAttribute('aria-label') || '' : '';
      const sidebarHasWork = sidebarAria.includes('Work') || !!sidebarItem?.querySelector('span')?.innerText?.includes('Work');

      const isWork = hasOutputsBtn || hasSourcesBtn || hasWorkBadge || sidebarHasWork;
      return {
        location: 'conversation',
        conversationId: convId,
        mode: isWork ? 'work' : 'chat',
        details: {
          title: document.title,
          hasWorkBadge,
          sidebarHasWork,
          hasOutputsBtn,
          hasSourcesBtn
        }
      };
    }
  })()`);
}

/**
 * Deterministically ensure the active ChatGPT session is set to the target mode ('chat' or 'work').
 * If currently inside a conversation, navigates to Home first (since existing conversation surfaces are immutable).
 * 
 * @param {Object} cdpClient - Connected CDP client
 * @param {'chat'|'work'} targetMode - Target surface mode
 * @returns {Promise<{ success: boolean, mode: 'chat'|'work', action: string }>}
 */
async function ensureMode(cdpClient, targetMode) {
  if (targetMode !== 'chat' && targetMode !== 'work') {
    throw new Error('targetMode must be "chat" or "work"');
  }

  let current = await detectSurface(cdpClient);

  if (current.location === 'conversation') {
    // Navigate back to home to initialize a new conversation in the target mode
    await cdpClient.eval(`(() => {
      const newChatBtn = document.querySelector('a[data-testid="new-chat-button"], a[href="/"]');
      if (newChatBtn) newChatBtn.click();
      else window.location.href = 'https://chatgpt.com/';
    })()`);

    // Poll until home surface buttons are mounted and hydrated
    for (let i = 0; i < 15; i++) {
      await sleep(300);
      current = await detectSurface(cdpClient);
      if (current.location === 'home' && current.mode !== 'pending_hydration') break;
    }
  }

  if (current.mode === targetMode) {
    return { success: true, mode: targetMode, action: 'already_set' };
  }

  // Toggle button on Home
  const toggleVal = targetMode === 'work' ? 'work' : 'chatgpt';
  await cdpClient.eval(`document.querySelector('button[data-tpp-toggle-value="${toggleVal}"]')?.click()`);
  await sleep(400);

  const verified = await detectSurface(cdpClient);
  return {
    success: verified.mode === targetMode,
    mode: verified.mode,
    action: 'toggled'
  };
}

/**
 * Query user's recent conversations grouped or filtered by surface (Chat vs Work).
 * @param {Object} cdpClient 
 * @param {Object} options - { limit: number, offset: number }
 * @returns {Promise<{ items: Array<{ id: string, title: string, mode: 'chat'|'work', conversation_origin: string|null }> }>}
 */
async function listConversationsByMode(cdpClient, options = {}) {
  const limit = options.limit || 20;
  const offset = options.offset || 0;

  return await cdpClient.eval(`(async () => {
    try {
      const rAuth = await fetch('/api/auth/session');
      const s = await rAuth.json();
      const token = s.accessToken;
      if (!token) return { error: 'No access token available' };

      const headers = { 'Authorization': 'Bearer ' + token };
      const rList = await fetch('/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated', { headers });
      const dList = await rList.json();

      const items = (dList.items || []).map(it => ({
        id: it.id,
        title: (it.title || '').trim(),
        mode: it.conversation_origin === 'tpp' ? 'work' : 'chat',
        conversation_origin: it.conversation_origin,
        update_time: it.update_time
      }));

      return { items };
    } catch(e) {
      return { error: e.message };
    }
  })()`);
}

const EFFORT_GEARS = {
  chat: {
    labels: ['Instant', 'Medium', 'High', 'Extra High', 'Pro'],
    aliases: {
      'instant': 0, 'low': 0, 'fast': 0, '0': 0,
      'medium': 1, 'med': 1, '1': 1,
      'high': 2, '2': 2,
      'extra_high': 3, 'extra-high': 3, 'extra high': 3, '3': 3,
      'pro': 4, 'max': 4, '4': 4
    }
  },
  work: {
    labels: ['Light', 'Medium', 'High', 'Extra High', 'Max', 'Ultra'],
    aliases: {
      'light': 0, 'low': 0, '0': 0,
      'medium': 1, 'med': 1, '1': 1,
      'high': 2, '2': 2,
      'extra_high': 3, 'extra-high': 3, 'extra high': 3, '3': 3,
      'max': 4, '4': 4,
      'ultra': 5, 'pro': 5, '5': 5
    }
  }
};

async function openComposerPill(client) {
  const isOpen = await client.eval(`(() => {
    const pill = document.querySelector('button.__composer-pill') || document.querySelector('.uFxlGa_WorkTrigger');
    return pill?.getAttribute('data-state') === 'open';
  })()`);
  if (isOpen) return true;

  const pos = await client.eval(`(() => {
    const pill = document.querySelector('button.__composer-pill') || document.querySelector('.uFxlGa_WorkTrigger');
    if (!pill) return null;
    const r = pill.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);

  if (!pos) return false;

  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  await sleep(40);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  await sleep(400);
  return true;
}

async function closeComposerPill(client) {
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(200);
}

/**
 * Detect current surface, active model, and thinking depth slider gear.
 * @param {Object} cdpClient 
 * @returns {Promise<Object>}
 */
async function detectModelAndEffort(cdpClient) {
  const surfaceInfo = await detectSurface(cdpClient);
  const surface = surfaceInfo.mode === 'work' ? 'work' : 'chat';

  const opened = await openComposerPill(cdpClient);
  if (!opened) {
    return {
      surface,
      model: null,
      effort: null,
      availableModels: [],
      error: 'Composer pill not found'
    };
  }

  const data = await cdpClient.eval(`(() => {
    const slider = document.querySelector('[role="slider"]');
    const valuenow = slider ? parseInt(slider.getAttribute('aria-valuenow') || '0', 10) : null;
    const valuemax = slider ? parseInt(slider.getAttribute('aria-valuemax') || '5', 10) : null;
    
    const radios = Array.from(document.querySelectorAll('[role="menuitemradio"]'));
    const checkedRadio = radios.find(r => r.getAttribute('aria-checked') === 'true');
    const activeModel = checkedRadio ? checkedRadio.innerText.split('\\n')[0].trim() : null;

    const available = radios.map(r => r.innerText.split('\\n')[0].trim()).filter(Boolean);

    const modelLabel = document.querySelector('.uFxlGa_SliderTriggerModelLabel')?.innerText?.trim();
    const effortLabel = document.querySelector('.uFxlGa_SliderTriggerEffortLabel')?.innerText?.trim();
    const pill = document.querySelector('button.__composer-pill') || document.querySelector('.uFxlGa_WorkTrigger');

    return {
      valuenow,
      valuemax,
      activeModel: activeModel || modelLabel || (pill ? pill.innerText.split('\\n')[0].trim() : null),
      effortLabel: effortLabel || (pill ? pill.innerText.split('\\n')[1]?.trim() : null),
      availableModels: Array.from(new Set(available))
    };
  })()`);

  await closeComposerPill(cdpClient);

  const gearConfig = EFFORT_GEARS[surface] || EFFORT_GEARS.chat;
  const gearLabel = data.valuenow !== null && gearConfig.labels[data.valuenow] ? gearConfig.labels[data.valuenow] : data.effortLabel;

  return {
    surface,
    model: data.activeModel,
    effort: {
      gear: data.valuenow,
      maxGear: data.valuemax,
      label: gearLabel,
      availableGears: gearConfig.labels
    },
    availableModels: data.availableModels
  };
}

/**
 * Configure target surface, model, and reasoning effort gear on ChatGPT web.
 * @param {Object} cdpClient 
 * @param {Object} options - { surface?: 'chat'|'work', model?: string, effort?: string|number }
 * @returns {Promise<Object>}
 */
async function setModelAndEffort(cdpClient, options = {}) {
  const { surface, model, effort } = options;

  if (surface && (surface === 'chat' || surface === 'work')) {
    await ensureMode(cdpClient, surface);
  }

  const currentSurface = (await detectSurface(cdpClient)).mode === 'work' ? 'work' : 'chat';

  const opened = await openComposerPill(cdpClient);
  if (!opened) throw new Error('Could not open composer pill menu');

  if (model) {
    const targetModelLower = model.toLowerCase();
    if (currentSurface === 'work') {
      await cdpClient.eval(`(() => {
        const radios = Array.from(document.querySelectorAll('[role="menuitemradio"]'));
        const target = radios.find(r => r.innerText.toLowerCase().includes('${targetModelLower}'));
        if (target) target.click();
      })()`);
      await sleep(350);
      await openComposerPill(cdpClient);
    } else {
      await cdpClient.eval(`(() => {
        const adv = document.querySelector('[data-testid="composer-model-picker-slider-advanced-view"]');
        if (!adv || adv.getAttribute('data-active') !== 'true') {
          const toggle = document.querySelector('.d1BZWq_ViewToggle');
          if (toggle) toggle.click();
        }
      })()`);
      await sleep(300);

      await cdpClient.eval(`(() => {
        const adv = document.querySelector('[data-testid="composer-model-picker-slider-advanced-view"]');
        const radios = Array.from((adv || document).querySelectorAll('[role="menuitemradio"]'));
        const target = radios.find(r => r.innerText.toLowerCase().includes('${targetModelLower}'));
        if (target) target.click();
      })()`);
      await sleep(350);
      await openComposerPill(cdpClient);
    }
  }

  if (effort !== undefined && effort !== null) {
    if (currentSurface === 'chat') {
      await cdpClient.eval(`(() => {
        const adv = document.querySelector('[data-testid="composer-model-picker-slider-advanced-view"]');
        if (adv && adv.getAttribute('data-active') === 'true') {
          const toggle = document.querySelector('.d1BZWq_ViewToggle');
          if (toggle) toggle.click();
        }
      })()`);
      await sleep(300);
    }

    const gearConfig = EFFORT_GEARS[currentSurface] || EFFORT_GEARS.chat;
    let targetGear = 0;
    if (typeof effort === 'number') {
      targetGear = effort;
    } else {
      const parsed = gearConfig.aliases[String(effort).toLowerCase()];
      targetGear = parsed !== undefined ? parsed : 2;
    }

    const sliderBounds = await cdpClient.eval(`(() => {
      const slider = document.querySelector('[role="slider"]');
      if (!slider) return null;
      slider.focus();
      return {
        min: parseInt(slider.getAttribute('aria-valuemin') || '0', 10),
        max: parseInt(slider.getAttribute('aria-valuemax') || '5', 10),
        current: parseInt(slider.getAttribute('aria-valuenow') || '0', 10)
      };
    })()`);

    if (sliderBounds) {
      const clamped = Math.max(sliderBounds.min, Math.min(sliderBounds.max, targetGear));

      for (let i = 0; i <= sliderBounds.max; i++) {
        await cdpClient.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
        await cdpClient.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
        await sleep(30);
      }

      for (let i = 0; i < clamped; i++) {
        await cdpClient.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
        await cdpClient.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
        await sleep(30);
      }
    }
  }

  const resultInfo = await cdpClient.eval(`(() => {
    const slider = document.querySelector('[role="slider"]');
    const pill = document.querySelector('button.__composer-pill') || document.querySelector('.uFxlGa_WorkTrigger');
    return {
      gear: slider ? parseInt(slider.getAttribute('aria-valuenow') || '0', 10) : null,
      maxGear: slider ? parseInt(slider.getAttribute('aria-valuemax') || '5', 10) : null,
      pillText: pill?.innerText?.trim()
    };
  })()`);

  await closeComposerPill(cdpClient);

  const gearConfig = EFFORT_GEARS[currentSurface] || EFFORT_GEARS.chat;
  const label = resultInfo.gear !== null ? gearConfig.labels[resultInfo.gear] : null;

  return {
    success: true,
    action: 'configured',
    surface: currentSurface,
    model: model || 'default',
    effort: {
      gear: resultInfo.gear,
      maxGear: resultInfo.maxGear,
      label
    },
    pillSummary: resultInfo.pillText
  };
}

/**
 * High-level orchestration function callable directly from MCP tools or CLI.
 * @param {Object} options - { port, action, targetSurface, limit, model, effort }
 * @returns {Promise<Object>}
 */
async function manageSurface(options = {}) {
  const port = options.port || 9222;
  const tab = await getChatGPTTab(port);
  if (!tab) {
    return { success: false, error: `No active ChatGPT tab found on CDP port ${port}` };
  }

  const client = new CdpClient(tab.webSocketDebuggerUrl);
  await client.connect();

  try {
    const action = options.action || 'detect';
    if (action === 'detect') {
      const current = await detectSurface(client);
      let modelAndEffort = null;
      try {
        modelAndEffort = await detectModelAndEffort(client);
      } catch {}
      return {
        success: true,
        action: 'detect',
        surface: current.mode,
        location: current.location,
        conversationId: current.conversationId,
        modelAndEffort,
        details: current.details
      };
    } else if (action === 'switch') {
      if (!options.targetSurface) {
        throw new Error('targetSurface ("chat" or "work") is required when action is "switch"');
      }
      const switchRes = await ensureMode(client, options.targetSurface);
      return {
        success: switchRes.success,
        action: 'switch',
        surface: switchRes.mode,
        operation: switchRes.action
      };
    } else if (action === 'configure') {
      const configRes = await setModelAndEffort(client, {
        surface: options.targetSurface,
        model: options.model,
        effort: options.effort
      });
      return {
        success: configRes.success,
        action: 'configure',
        ...configRes
      };
    } else if (action === 'list_conversations') {
      const list = await listConversationsByMode(client, { limit: options.limit || 20 });
      return {
        success: true,
        action: 'list_conversations',
        total: list.items ? list.items.length : 0,
        conversations: list.items || []
      };
    } else {
      throw new Error(`Unknown action: ${action}`);
    }
  } finally {
    client.close();
  }
}

/**
 * 通过 CDP DOM.setFileInputFiles 物理上传文件或图片至 ChatGPT 输入框
 */
async function uploadFileViaCdp(client, filePath) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`File does not exist: ${absPath}`);
  }

  try {
    await client.send('Page.bringToFront');
  } catch (_) {}

  await client.send('DOM.enable');
  const doc = await client.send('DOM.getDocument', { depth: -1 });
  let queryRes = await client.send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: '#upload-files'
  });

  if (!queryRes || !queryRes.nodeId) {
    queryRes = await client.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: 'input[type="file"]'
    });
  }

  if (!queryRes || !queryRes.nodeId) {
    throw new Error('Could not find file input element in ChatGPT composer DOM.');
  }

  await client.send('DOM.setFileInputFiles', {
    files: [absPath],
    nodeId: queryRes.nodeId
  });

  // 等待附件卡片或图片预览挂载完成
  const baseName = path.basename(absPath);
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const attached = await client.eval(`
      (() => {
        const cards = Array.from(document.querySelectorAll('[data-testid*="attachment"], [class*="file-tile"], [class*="file"], [class*="image"], div[role="group"] img')).map(el => el.alt || el.innerText || el.getAttribute('aria-label') || '');
        const hasCard = cards.some(t => t.includes(${JSON.stringify(baseName)})) || document.querySelectorAll('[data-testid*="attachment"], [class*="file-tile"], div[role="group"] img').length > 0;
        const isUploading = !!document.querySelector('[class*="loading"], [class*="spinner"], [data-testid*="uploading"], [role="progressbar"]');
        return hasCard && !isUploading;
      })()
    `).catch(() => false);
    if (attached) {
      await sleep(1500);
      return { success: true, fileName: baseName };
    }
  }
  await sleep(2000);
  return { success: true, fileName: baseName, note: 'Attachment dispatched' };
}

const STOP_BUTTON_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[aria-label="Stop answering"]',
  'button[aria-label="Stop generating"]',
  'button[aria-label="Stop streaming"]',
  'button[aria-label="Stop thinking"]',
  'button[aria-label*="Stop"]'
].join(', ');

const SEND_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label="Send prompt"]',
  'button[aria-label*="Send"]'
].join(', ');

/**
 * 权威四重互锁终态收敛检测引擎 (Quad-Lock Turn Quiescence Watchdog)
 * 彻底替换旧版 "字符 > 300 + 静止 3 秒" 的高危假性收敛逻辑。
 */
async function checkTurnConvergence(client, options = {}) {
  const convId = options.convId || null;
  const domStatus = await client.eval(`(() => {
    // 1. 检查停止按钮
    const stopBtns = Array.from(document.querySelectorAll('${STOP_BUTTON_SELECTORS}')).map(b => ({
      ariaLabel: b.getAttribute('aria-label'),
      testid: b.getAttribute('data-testid'),
      innerText: b.innerText
    }));
    const hasStopButton = stopBtns.length > 0;

    // 2. 检查发送按钮
    const sendBtn = document.querySelector('${SEND_BUTTON_SELECTORS}');
    const sendReady = !!(sendBtn && !sendBtn.disabled);

    // 3. 检查活动指示徽章
    const badges = Array.from(document.querySelectorAll('[class*="badge"], [class*="status"], div, span')).map(el => {
      const t = (el.innerText || '').trim();
      if (/^(working|thinking|searching|preparing)\\b/i.test(t) && t.length < 50) return t;
      return null;
    }).filter(Boolean);
    const hasActiveSpinner = badges.length > 0;

    // 4. 检查 Outputs 附件卡片状态
    const previewEl = document.querySelector('[class*="loading"], [class*="spinner"]');
    const downloadBtns = Array.from(document.querySelectorAll('button[aria-label="Download file"], button[aria-label="Download"]'));
    const hasOutputs = downloadBtns.length > 0;

    // 提取当前最新可见回答文本
    const articles = Array.from(document.querySelectorAll('article, [data-message-author-role="assistant"]'));
    const last = articles.length > 0 ? articles[articles.length - 1] : null;
    const domText = last ? last.innerText : '';

    return {
      hasStopButton,
      stopButtons: stopBtns,
      sendReady,
      hasActiveSpinner,
      activeBadges: badges,
      hasOutputs,
      outputsReady: !previewEl,
      textLength: domText.length,
      currentUrl: window.location.href
    };
  })()`);

  let backendCompleted = false;
  let officialTitle = '';
  let fullBackendText = '';
  let lastMessageId = null;

  const targetConvId = convId || (domStatus.currentUrl && domStatus.currentUrl.includes('/c/') ? domStatus.currentUrl.split('/c/')[1] : null);

  if (targetConvId) {
    const backendStatus = await client.eval(`(async () => {
      try {
        const s = await fetch('/api/auth/session').then(r => r.json());
        const token = s.accessToken;
        const r = await fetch('/backend-api/conversation/${targetConvId}', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!r.ok) return { ok: false, status: r.status };
        const d = await r.json();
        const current = d.current_node;
        const currMsg = d.mapping[current]?.message;
        
        let latestAssistantText = '';
        let latestMsgId = null;
        for (const k in (d.mapping || {})) {
          const m = d.mapping[k].message;
          if (m && m.author?.role === 'assistant' && m.content?.content_type === 'text') {
            const parts = (m.content?.parts || []).filter(p => typeof p === 'string');
            const t = parts.join('\\n');
            if (t.length >= latestAssistantText.length) {
              latestAssistantText = t;
              latestMsgId = m.id;
            }
          }
        }

        return {
          ok: true,
          title: d.title,
          currentNodeId: current,
          status: currMsg?.status,
          endTurn: currMsg?.end_turn,
          latestMsgId,
          textLength: latestAssistantText.length,
          fullText: latestAssistantText
        };
      } catch(e) {
        return { ok: false, error: e.message };
      }
    })()`);

    if (backendStatus && backendStatus.ok) {
      officialTitle = backendStatus.title || '';
      fullBackendText = backendStatus.fullText || '';
      lastMessageId = backendStatus.latestMsgId;
      backendCompleted = backendStatus.status === 'finished_successfully' && backendStatus.endTurn === true;
    }
  }

  const currentTextLength = Math.max(domStatus.textLength, fullBackendText.length);

  // 双阶停滞感知看门狗 (Stall-Breaker Watchdog)
  const stallThresholdMs = options.stallThresholdMs || 60000;
  let isStalled = false;
  const tracker = options.tracker;
  if (tracker && typeof tracker === 'object') {
    if (currentTextLength > 0 && currentTextLength === tracker.lastTextLength) {
      if (tracker.lastChangeTime && (Date.now() - tracker.lastChangeTime >= stallThresholdMs)) {
        isStalled = true;
      }
    } else if (currentTextLength !== tracker.lastTextLength) {
      tracker.lastTextLength = currentTextLength;
      tracker.lastChangeTime = Date.now();
    }
  }

  // 识别僵尸 Stop 按钮 (Zombie Stop Button)
  // 当后端已明确返回 finished_successfully 且 endTurn: true，即便 DOM 中残留 stopButton，亦判定已完成生成
  const isZombieStop = domStatus.hasStopButton && backendCompleted;
  const activeStopButton = domStatus.hasStopButton && !backendCompleted;

  // 决策生成中状态：若后端已明确完成且无活动 Stop/Spinner，则判定生成已停止；若后端未完成，则需等待 Send 恢复
  const isGenerating = (activeStopButton || (!backendCompleted && !domStatus.sendReady) || domStatus.hasActiveSpinner || (targetConvId ? !backendCompleted : false)) && !isZombieStop;

  // 终态判定：未在生成 (或后端已明确完成/僵尸Stop) 且 有文本输出 且 Outputs 附件卡片已就绪
  const hasText = currentTextLength > 0;
  const outputsReady = !domStatus.hasOutputs || domStatus.outputsReady;
  const isSettled = (!isGenerating || isZombieStop || backendCompleted) && hasText && outputsReady;

  return {
    isGenerating: !isSettled && isGenerating,
    isSettled,
    isStalled,
    isZombieStop,
    backendCompleted,
    sendReady: domStatus.sendReady,
    hasStopButton: domStatus.hasStopButton,
    hasOutputs: domStatus.hasOutputs,
    outputsReady: domStatus.outputsReady,
    textLength: currentTextLength,
    fullText: fullBackendText || '',
    officialTitle,
    convId: targetConvId,
    lastMessageId
  };
}

/**
 * Work 模式特有伴生产物 (Outputs) 物理拦截下载与落盘引擎
 */
async function downloadWorkOutputs(client, targetOutputsDir, options = {}) {
  const fs = require('node:fs');
  const path = require('node:path');
  const crypto = require('node:crypto');
  fs.mkdirSync(targetOutputsDir, { recursive: true });

  try {
    await client.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: targetOutputsDir,
      eventsEnabled: true
    });
  } catch (_) {
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: targetOutputsDir
    });
  }

  const clickRes = await client.eval(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const dlBtn = btns.find(b => {
      const label = b.getAttribute('aria-label') || '';
      const text = (b.innerText || '').trim();
      return label === 'Download file' || label === 'Download' || text === 'Download' || text.includes('Download');
    });
    if (!dlBtn) return { success: false, error: 'no_download_button' };
    dlBtn.click();
    return { success: true, label: dlBtn.getAttribute('aria-label') };
  })()`);

  if (!clickRes || !clickRes.success) {
    return { success: false, error: clickRes?.error || 'click_failed' };
  }

  const maxWaitMs = options.timeoutMs || 25000;
  const start = Date.now();
  let downloadedFile = null;

  while (Date.now() - start < maxWaitMs) {
    await sleep(1000);
    const files = fs.readdirSync(targetOutputsDir).filter(f => !f.endsWith('.crdownload') && !f.endsWith('.tmp') && f !== 'manifest.json');
    if (files.length > 0) {
      downloadedFile = files[0];
      break;
    }
  }

  if (!downloadedFile) {
    return { success: false, error: 'download_timeout' };
  }

  const fullPath = path.join(targetOutputsDir, downloadedFile);
  const stat = fs.statSync(fullPath);
  const bytes = fs.readFileSync(fullPath);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');

  const manifest = {
    downloadedAt: new Date().toISOString(),
    filename: downloadedFile,
    bytes: stat.size,
    sha256: hash
  };
  fs.writeFileSync(path.join(targetOutputsDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  return {
    success: true,
    filename: downloadedFile,
    path: fullPath,
    bytes: stat.size,
    sha256: hash,
    manifestPath: path.join(targetOutputsDir, 'manifest.json')
  };
}

const DIVERGENCE_PATTERNS = [
  /(?:架构|设计|方案|思路)(?:完全|彻底|根本)?(?:错误|不正确|不对|有问题|行不通|不可行)/i,
  /(?:理解错|理解偏差|偏离|跑偏|完全偏离|搞错)(?:需求|目的|主题|方向)/i,
  /(?:推倒重来|彻底推翻|推翻重做|重写|全部重写|别写了|不要这个)/i,
  /(?:立即停止|赶紧停止|强制停止|马上停止|中止|寸止)/i
];

/**
 * 分类提示词是属于“严重架构错误/方向跑偏（需强制 Stop 纠偏）”还是“常规增量（等待终态补充）”
 */
function classifyDivergence(prompt, options = {}) {
  if (!prompt || typeof prompt !== 'string') {
    return { isDivergent: false, reason: 'empty_prompt', action: 'append_turn' };
  }

  if (options.forceSteer || options.action === 'steer' || options.action === 'stop_and_steer') {
    return { isDivergent: true, reason: 'explicit_option', action: 'stop_and_steer' };
  }

  for (const pattern of DIVERGENCE_PATTERNS) {
    if (pattern.test(prompt)) {
      return {
        isDivergent: true,
        reason: `matched_divergence_pattern: ${pattern}`,
        action: 'stop_and_steer'
      };
    }
  }

  return {
    isDivergent: false,
    reason: 'supplementary_continuation',
    action: 'append_turn'
  };
}

/**
 * 物理点击页面 Stop 按钮强制熔断单任务生成 (Physical Click Stop Button)
 * @param {Object} client - CdpClient
 * @returns {Promise<{ success: boolean, clicked: boolean, label?: string, error?: string }>}
 */
async function forceStop(client) {
  return await client.eval(`(() => {
    const stopBtn = document.querySelector('${STOP_BUTTON_SELECTORS}');
    if (stopBtn) {
      stopBtn.click();
      return { success: true, clicked: true, label: stopBtn.getAttribute('aria-label') || stopBtn.innerText || 'Stop' };
    }
    return { success: false, clicked: false, error: 'Stop button not found' };
  })()`);
}

/**
 * 强制寸止与纠偏注入引擎 (Forced Stop and Steer Engine)
 * 1. 检查当前是否处于生成态 (isGenerating)
 * 2. 若在生成，点击 Stop 按钮强制熔断当前轮次
 * 3. 轮询等待 Stop 按钮消失且 Send 按钮重新就绪
 * 4. 注入 steerPrompt 纠偏提示词并触发发送
 */
async function forceStopAndSteer(client, steerPrompt, options = {}) {
  const current = await checkTurnConvergence(client, options);
  let interrupted = false;

  if (current.isGenerating) {
    // 触发物理 Stop 按钮点击
    const stopRes = await forceStop(client);
    interrupted = !!stopRes?.clicked;

    // 轮询等待控制权复位 (Stop 按钮彻底消失且 Send 按钮重新挂载就绪)
    const maxWaitMs = options.waitResetMs || 10000;
    const start = Date.now();
    let sendReady = false;

    while (Date.now() - start < maxWaitMs) {
      await sleep(250);
      const readyCheck = await client.eval(`(() => {
        const hasStop = !!document.querySelector('${STOP_BUTTON_SELECTORS}');
        const sendBtn = document.querySelector('${SEND_BUTTON_SELECTORS}');
        const isSendReady = !!(sendBtn && !sendBtn.disabled);
        return !hasStop && isSendReady;
      })()`);
      if (readyCheck) {
        sendReady = true;
        break;
      }
    }

    if (!sendReady) {
      throw new Error('强制中断后等待 Send 按钮就绪超时');
    }
  }

  // 注入并发送纠偏提示词
  const escaped = JSON.stringify(steerPrompt);
  const sendRes = await client.eval(`(async () => {
    const el = document.querySelector('#prompt-textarea');
    if (!el) return { success: false, error: 'no textarea' };
    el.focus();
    const raw = ${escaped};
    const paragraphs = raw.split('\\n').map(line => {
      const escapedLine = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return '<p>' + (escapedLine || '<br>') + '</p>';
    }).join('');
    el.innerHTML = paragraphs;
    el.dispatchEvent(new Event('input', { bubbles: true }));

    for (let a = 0; a < 20; a++) {
      await new Promise(r => setTimeout(r, 200));
      const btn = document.querySelector('${SEND_BUTTON_SELECTORS}');
      if (btn && !btn.disabled) {
        btn.click();
        return { success: true };
      }
    }
    return { success: false, error: 'send button disabled after steer injection' };
  })()`);

  return {
    success: !!sendRes?.success,
    interrupted,
    action: interrupted ? 'interrupted_and_steered' : 'appended_directly',
    promptLength: steerPrompt.length,
    error: sendRes?.error
  };
}

/**
 * 模拟物理 F5 自刷新并等待 React SPA 数据重水合 (Simulate F5 Reload & Re-hydration)
 * 当页面出现假死、长连接静默挂起或渲染停滞时调用，重置 Blink 渲染进程微任务队列并重新从后端拉取完整数据。
 */
async function reloadAndHydrate(client, options = {}) {
  const timeoutMs = options.timeoutMs || 25000;
  const start = Date.now();

  try {
    if (typeof client.send === 'function') {
      await client.send('Page.enable').catch(() => {});
      client.send('Page.reload', { ignoreCache: false }).catch(() => {});
    } else {
      client.eval('window.location.reload()').catch(() => {});
    }
  } catch (_) {
    await client.eval('window.location.reload()').catch(() => {});
  }

  // 关闭旧 WebSocket 连接，等待页面刷新
  if (typeof client.close === 'function') {
    client.close();
  }
  await sleep(1500);

  // 轮询重连
  let reconnected = false;
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      await client.connect();
      reconnected = true;
      break;
    } catch (_) {
      await sleep(400);
    }
  }

  if (!reconnected) {
    throw new Error('F5 刷新后重新连接 CDP WebSocket 超时');
  }

  // 轮询等待 React SPA 水合完成与数据重填
  let hydrated = false;
  let finalState = null;
  while (Date.now() - start < timeoutMs) {
    await sleep(500);
    const check = await client.eval(`(() => {
      const textarea = document.querySelector('#prompt-textarea');
      const mainText = document.querySelector('main')?.innerText || '';
      const articles = document.querySelectorAll('article, [data-message-author-role="assistant"]');
      const stopBtn = document.querySelector('${STOP_BUTTON_SELECTORS}');
      const sendBtn = document.querySelector('${SEND_BUTTON_SELECTORS}');

      if (!textarea && articles.length === 0) return null;

      return {
        hasTextarea: !!textarea,
        mainTextLen: mainText.length,
        articlesCount: articles.length,
        hasStop: !!stopBtn,
        sendReady: !!(sendBtn && !sendBtn.disabled),
        title: document.title,
        url: window.location.href
      };
    })()`).catch(() => null);

    if (check && (check.hasTextarea || check.articlesCount > 0)) {
      if (check.mainTextLen > 500 || !check.hasStop) {
        hydrated = true;
        finalState = check;
        break;
      }
    }
  }

  return {
    success: hydrated,
    elapsedMs: Date.now() - start,
    state: finalState
  };
}

module.exports = {
  CdpClient,
  FlatSessionClient,
  attachFlatSession,
  getChatGPTTab,
  detectSurface,
  ensureMode,
  listConversationsByMode,
  detectModelAndEffort,
  setModelAndEffort,
  manageSurface,
  checkTurnConvergence,
  downloadWorkOutputs,
  classifyDivergence,
  forceStop,
  forceStopAndSteer,
  reloadAndHydrate,
  uploadFileViaCdp,
  DIVERGENCE_PATTERNS,
  STOP_BUTTON_SELECTORS,
  SEND_BUTTON_SELECTORS,
  EFFORT_GEARS
};
