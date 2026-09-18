(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        const code = `
            (() => {
                const el = document.querySelector('#prompt-textarea');
                return JSON.stringify({
                    id: el?.id,
                    className: el?.className,
                    isContentEditable: el?.isContentEditable,
                    innerHTML: el?.innerHTML,
                    outerHTML: el?.outerHTML.slice(0, 300)
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
        console.log('Textarea info:', JSON.parse(e.data).result?.result?.value);
        ws.close();
    };
})();
