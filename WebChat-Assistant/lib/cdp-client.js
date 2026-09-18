const http = require('http');

class CdpClient {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.ws = null;
        this.msgId = 1;
        this.callbacks = new Map();
        this.eventListeners = new Map();
    }

    async connect(timeoutMs = 10000) {
        const WS = globalThis.WebSocket;
        if (!WS) throw new Error('Global WebSocket not available in current Node.js runtime.');

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.ws) try { this.ws.close(); } catch (_) {}
                reject(new Error(`CDP WebSocket connect timeout after ${timeoutMs}ms: ${this.wsUrl}`));
            }, timeoutMs);

            try {
                this.ws = new WS(this.wsUrl);
            } catch (err) {
                clearTimeout(timer);
                return reject(err);
            }

            this.ws.onopen = () => {
                clearTimeout(timer);
                resolve();
            };

            this.ws.onerror = (err) => {
                clearTimeout(timer);
                reject(err);
            };

            this.ws.onmessage = (event) => {
                try {
                    const raw = typeof event.data === 'string' ? event.data : event.data.toString();
                    const data = JSON.parse(raw);

                    if (data.id && this.callbacks.has(data.id)) {
                        const cb = this.callbacks.get(data.id);
                        this.callbacks.delete(data.id);
                        if (data.error) {
                            cb.reject(new Error(data.error.message || JSON.stringify(data.error)));
                        } else {
                            cb.resolve(data.result);
                        }
                    } else if (data.method) {
                        const listeners = this.eventListeners.get(data.method) || [];
                        listeners.forEach(fn => {
                            try { fn(data.params); } catch (_) {}
                        });
                    }
                } catch (_) {}
            };

            this.ws.onclose = () => {
                for (const [, cb] of this.callbacks) {
                    cb.reject(new Error('CDP connection closed'));
                }
                this.callbacks.clear();
            };
        });
    }

    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== 1) {
                return reject(new Error('CDP WebSocket is not open'));
            }
            const id = ++this.msgId;
            this.callbacks.set(id, { resolve, reject });
            try {
                this.ws.send(JSON.stringify({ id, method, params }));
            } catch (err) {
                this.callbacks.delete(id);
                reject(err);
            }
        });
    }

    on(event, handler) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(handler);
    }

    async evaluate(expression, awaitPromise = false) {
        const res = await this.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise
        });
        if (res?.exceptionDetails) {
            const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
            console.error('CDP Runtime.evaluate exception:', desc);
        }
        return res?.result?.value;
    }

    close() {
        if (this.ws) {
            try { this.ws.close(); } catch (_) {}
            this.ws = null;
        }
    }
}

class FlatSessionClient {
    constructor(browserClient, sessionId, targetId) {
        this.browserClient = browserClient;
        this.sessionId = sessionId;
        this.targetId = targetId;
        this.msgId = 1;
        this.callbacks = new Map();

        this.browserClient.on('Target.receivedMessageFromTarget', (params) => {
            if (params.sessionId !== this.sessionId) return;
            try {
                const data = JSON.parse(params.message);
                if (data.id && this.callbacks.has(data.id)) {
                    const cb = this.callbacks.get(data.id);
                    this.callbacks.delete(data.id);
                    if (data.error) {
                        cb.reject(new Error(data.error.message || JSON.stringify(data.error)));
                    } else {
                        cb.resolve(data.result);
                    }
                }
            } catch (_) {}
        });
    }

    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++this.msgId;
            this.callbacks.set(id, { resolve, reject });
            const rawMessage = JSON.stringify({ id, method, params });
            this.browserClient.send('Target.sendMessageToTarget', {
                message: rawMessage,
                sessionId: this.sessionId
            }).catch(reject);
        });
    }

    async evaluate(expression, awaitPromise = false) {
        const res = await this.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise
        });
        return res?.result?.value;
    }

    async close() {
        try {
            await this.browserClient.send('Target.detachFromTarget', { sessionId: this.sessionId });
        } catch (_) {}
    }
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let buf = '';
            res.on('data', chunk => buf += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(buf));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function getBrowserWsUrl(port = 9222) {
    const info = await fetchJson(`http://127.0.0.1:${port}/json/version`);
    return info.webSocketDebuggerUrl;
}

async function attachFlatSession(port, targetId) {
    const browserWs = await getBrowserWsUrl(port);
    const browserClient = new CdpClient(browserWs);
    await browserClient.connect();
    const attachRes = await browserClient.send('Target.attachToTarget', {
        targetId,
        flatten: true
    });
    return new FlatSessionClient(browserClient, attachRes.sessionId, targetId);
}

module.exports = {
    CdpClient,
    FlatSessionClient,
    fetchJson,
    getBrowserWsUrl,
    attachFlatSession
};
