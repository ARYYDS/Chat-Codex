(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        const code = `
            (() => {
                const composer = document.querySelector('form') || document.querySelector('#prompt-textarea')?.closest('div.relative');
                const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
                    testid: b.getAttribute('data-testid'),
                    ariaLabel: b.getAttribute('aria-label'),
                    className: b.className,
                    html: b.innerHTML.slice(0, 100)
                }));
                return JSON.stringify(buttons);
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
        console.log('Buttons:', JSON.parse(e.data).result?.result?.value);
        ws.close();
    };
})();
