(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        const code = `
            (() => {
                const turns = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
                return JSON.stringify({
                    turnCount: turns.length,
                    latestResponse: turns[turns.length - 1]?.innerText?.slice(0, 500)
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
        console.log('Assistant response in DOM:', JSON.parse(e.data).result?.result?.value);
        ws.close();
    };
})();
