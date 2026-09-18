(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.id === '578E06756D921C072C196D9D02703B9F');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        ws.send(JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: {
                expression: `
                    (() => {
                        return Array.from(document.querySelectorAll('button')).map(b => ({
                            testid: b.getAttribute('data-testid'),
                            aria: b.getAttribute('aria-label'),
                            text: b.innerText
                        })).filter(b => b.testid || b.aria || b.text);
                    })()
                `,
                returnByValue: true
            }
        }));
    };
    ws.onmessage = (e) => {
        console.log('Buttons:', JSON.parse(e.data).result?.result?.value);
        ws.close();
    };
})();
