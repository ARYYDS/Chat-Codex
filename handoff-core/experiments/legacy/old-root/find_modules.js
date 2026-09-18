(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        const code = `
            (async () => {
                const res = performance.getEntriesByType('resource')
                    .filter(r => r.name.includes('/cdn/assets/') && r.name.endsWith('.js'))
                    .map(r => r.name);
                const results = [];
                for (const url of res) {
                    try {
                        const txt = await fetch(url).then(r => r.text());
                        const hasConversation = txt.includes('/backend-api/conversation');
                        const hasPow = txt.includes('proofofwork') || txt.includes('difficulty');
                        if (hasConversation || hasPow) {
                            results.push({ url, hasConversation, hasPow, size: txt.length });
                        }
                    } catch(e) {}
                }
                return JSON.stringify(results);
            })()
        `;
        ws.send(JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: {
                expression: code,
                returnByValue: true,
                awaitPromise: true
            }
        }));
    };
    ws.onmessage = (e) => {
        console.log('Results:', JSON.parse(e.data).result?.result?.value);
        ws.close();
    };
})();
