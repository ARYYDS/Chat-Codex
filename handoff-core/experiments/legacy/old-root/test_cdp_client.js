class CdpClient {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.ws = null;
        this.msgId = 1;
        this.callbacks = new Map();
    }

    async connect() {
        this.ws = new WebSocket(this.wsUrl);
        await new Promise((resolve, reject) => {
            this.ws.onopen = resolve;
            this.ws.onerror = reject;
        });
        this.ws.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.id && this.callbacks.has(data.id)) {
                    this.callbacks.get(data.id)(data);
                    this.callbacks.delete(data.id);
                }
            } catch (err) {}
        };
    }

    send(method, params = {}) {
        return new Promise((resolve) => {
            const id = ++this.msgId;
            this.callbacks.set(id, resolve);
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluate(expression, awaitPromise = false) {
        const res = await this.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise
        });
        return res?.result?.result?.value;
    }

    close() {
        if (this.ws) {
            this.ws.close();
        }
    }
}

(async () => {
    const browserWsUrl = await fetch('http://127.0.0.1:9222/json/version')
        .then(r => r.json())
        .then(d => d.webSocketDebuggerUrl);

    const browser = new CdpClient(browserWsUrl);
    await browser.connect();

    // Create target
    const createRes = await browser.send('Target.createTarget', { url: 'https://chatgpt.com/' });
    const targetId = createRes.result.targetId;
    console.log('Created tab targetId:', targetId);

    // Connect to page
    const page = new CdpClient(`ws://127.0.0.1:9222/devtools/page/${targetId}`);
    await page.connect();

    // Poll until textarea is ready
    const start = Date.now();
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 500));
        const ready = await page.evaluate(`
            (() => {
                const el = document.querySelector('#prompt-textarea');
                const send = document.querySelector('button[data-testid="send-button"]');
                return !!el && !!send;
            })()
        `);
        if (ready) {
            console.log(`Page ready in ${Date.now() - start}ms!`);
            break;
        }
    }

    // Close page
    await browser.send('Target.closeTarget', { targetId });
    page.close();
    browser.close();
    console.log('Cleaned up target successfully!');
})();
