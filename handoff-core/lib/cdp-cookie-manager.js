'use strict';

/**
 * CDP Browser Target 纯内存凭据导出与动态回填管理器
 * 彻底废除需 Windows 管理员特权的 VSS 卷影快照机制，天然免疫 Chrome 127+ App-Bound Encryption (v20) 磁盘不可解密限制
 */

const WebSocket = globalThis.WebSocket || require('ws');

async function getBrowserWsUrl(port, timeoutMs = 2000) {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching /json/version from port ${port}`);
  const data = await res.json();
  if (!data.webSocketDebuggerUrl) throw new Error(`webSocketDebuggerUrl not found on port ${port}`);
  return data.webSocketDebuggerUrl;
}

/**
 * 从运行中的 Chrome Browser Target 内存直出所有已解密明文 Cookie
 * @param {number} port 端口号 (如 9225 或 9222)
 * @param {number} timeoutMs 超时时间
 * @returns {Promise<Array>} Cookie 列表
 */
async function dumpCookiesFromBrowserTarget(port, timeoutMs = 3000) {
  const wsUrl = await getBrowserWsUrl(port, timeoutMs);
  const ws = new WebSocket(wsUrl);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Timeout (${timeoutMs}ms) dumping cookies via Browser Target on port ${port}`));
    }, timeoutMs);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 101,
        method: 'Storage.getCookies',
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id === 101) {
          clearTimeout(timer);
          ws.close();
          resolve(msg.result?.cookies || []);
        }
      } catch (e) {
        clearTimeout(timer);
        ws.close();
        reject(e);
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timer);
      reject(err);
    };
  });
}

/**
 * 将凭据批量动态灌入空白 Worker 实例的内存中
 * @param {number} targetPort 目标 Worker 端口
 * @param {Array} cookies Cookie 数组
 * @param {number} timeoutMs 超时时间
 */
async function injectCookiesToWorker(targetPort, cookies, timeoutMs = 3000) {
  if (!Array.isArray(cookies) || cookies.length === 0) return { injected: 0 };
  const wsUrl = await getBrowserWsUrl(targetPort, timeoutMs);
  const ws = new WebSocket(wsUrl);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Timeout injecting cookies to worker on port ${targetPort}`));
    }, timeoutMs);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 102,
        method: 'Storage.setCookies',
        params: { cookies },
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id === 102) {
          clearTimeout(timer);
          ws.close();
          resolve({ success: true, count: cookies.length });
        }
      } catch (e) {
        clearTimeout(timer);
        ws.close();
        reject(e);
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timer);
      reject(err);
    };
  });
}

/**
 * 从 Master (默认 9225) 导出 Cookie 并同步灌入指定 Worker 列表 (默认 [9222, 9223])
 * @param {number} masterPort Master Chrome CDP 端口
 * @param {Array<number>} workerPorts 目标 Worker 端口列表
 * @param {number} timeoutMs 超时时间
 * @returns {Promise<{ success: boolean, durationMs: number, cookieCount: number, injectedWorkers: Array<{ port: number, success: boolean, count?: number, error?: string }> }>}
 */
async function syncMasterCookiesToWorkers(masterPort = 9225, workerPorts = [9222, 9223], timeoutMs = 3000) {
  const startTime = Date.now();
  const cookies = await dumpCookiesFromBrowserTarget(masterPort, timeoutMs);
  const injectedWorkers = [];

  for (const port of workerPorts) {
    try {
      const res = await injectCookiesToWorker(port, cookies, timeoutMs);
      injectedWorkers.push({ port, success: true, count: res.count ?? cookies.length });
    } catch (err) {
      injectedWorkers.push({ port, success: false, error: err.message });
    }
  }

  return {
    success: true,
    durationMs: Date.now() - startTime,
    cookieCount: cookies.length,
    injectedWorkers,
  };
}

module.exports = {
  getBrowserWsUrl,
  dumpCookiesFromBrowserTarget,
  injectCookiesToWorker,
  syncMasterCookiesToWorkers,
};
