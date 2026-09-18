(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.id === '5752AA4CFA65D73DF9690F3E0CDD865B');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        const code = `
            (() => {
                const turn = document.querySelector('[data-message-author-role="assistant"]');
                return turn ? turn.innerText : 'not found';
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
        console.log('Full response length:', JSON.parse(e.data).result?.result?.value?.length);
        console.log('Response sample:\n', JSON.parse(e.data).result?.result?.value?.slice(0, 1000));
        ws.close();
    };
})();
