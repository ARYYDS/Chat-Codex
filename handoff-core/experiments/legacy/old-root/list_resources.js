(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        const code = `
            (() => {
                const res = performance.getEntriesByType('resource')
                    .filter(r => r.name.endsWith('.js') || r.name.includes('/_next/'))
                    .map(r => r.name);
                return JSON.stringify(res.slice(0, 30));
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
        console.log(JSON.parse(e.data).result?.result?.value);
        ws.close();
    };
})();
