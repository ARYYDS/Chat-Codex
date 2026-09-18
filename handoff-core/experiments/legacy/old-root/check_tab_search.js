(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.id === '5752AA4CFA65D73DF9690F3E0CDD865B');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        const code = `
            (() => {
                const turns = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
                const lastTurn = turns[turns.length - 1];
                const searches = Array.from(document.querySelectorAll('[data-testid*="search"], [aria-label*="search"], [aria-label*="Search"]')).map(e => e.innerText || e.getAttribute('aria-label'));
                const stopBtn = !!document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop streaming"]');
                return JSON.stringify({
                    url: window.location.href,
                    isStreaming: stopBtn,
                    textLen: lastTurn?.innerText?.length || 0,
                    preview: lastTurn?.innerText?.slice(0, 300),
                    searches
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
        console.log('Tab status:', JSON.parse(e.data).result?.result?.value);
        ws.close();
    };
})();
