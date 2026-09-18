(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        const code = `
            (() => {
                if (!window.__capturedRequests) {
                    window.__capturedRequests = [];
                    const origFetch = window.fetch;
                    window.fetch = async function(...args) {
                        try {
                            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
                            const options = args[1] || {};
                            if (url && (url.includes('conversation') || url.includes('sentinel') || url.includes('backend-api'))) {
                                let body = options.body;
                                try { body = JSON.parse(body); } catch(e) {}
                                window.__capturedRequests.push({
                                    url,
                                    method: options.method || 'GET',
                                    headers: options.headers,
                                    body: body,
                                    time: Date.now()
                                });
                            }
                        } catch(e) {}
                        return origFetch.apply(this, args);
                    };
                }
                return 'hook installed';
            })()
        `;
        ws.send(JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: {
                expression: code,
                returnByValue: true
            }
        }));
    };
    ws.onmessage = (e) => {
        console.log('Hook result:', JSON.parse(e.data).result?.result?.value);
        ws.close();
    };
})();
