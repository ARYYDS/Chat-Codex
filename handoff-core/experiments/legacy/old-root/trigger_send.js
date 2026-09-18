(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        const code = `
            (() => {
                const btn = document.querySelector('button[data-testid="send-button"]');
                if (!btn) return 'no send btn';
                btn.click();
                return 'clicked';
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
    ws.onmessage = async (e) => {
        console.log('Click result:', JSON.parse(e.data).result?.result?.value);
        
        // Wait 3 seconds to let fetch happen
        await new Promise(r => setTimeout(r, 3000));
        
        ws.send(JSON.stringify({
            id: 2,
            method: 'Runtime.evaluate',
            params: {
                expression: `JSON.stringify(window.__capturedRequests, null, 2)`,
                returnByValue: true
            }
        }));
        
        ws.onmessage = (e2) => {
            console.log('Captured requests:');
            console.log(JSON.parse(e2.data).result?.result?.value);
            ws.close();
        };
    };
})();
