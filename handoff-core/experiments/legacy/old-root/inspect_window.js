(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        const code = `
            (() => {
                const keys = Object.keys(window).filter(k => 
                    k.toLowerCase().includes('turnstile') || 
                    k.toLowerCase().includes('sentinel') || 
                    k.toLowerCase().includes('oai') ||
                    k.toLowerCase().includes('arkose')
                );
                return JSON.stringify({
                    keys: keys,
                    turnstile: typeof window.turnstile !== 'undefined',
                    turnstileKeys: window.turnstile ? Object.keys(window.turnstile) : []
                });
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
        console.log('Window inspection:', JSON.parse(e.data).result?.result?.value);
        ws.close();
    };
})();
