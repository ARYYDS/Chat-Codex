(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        const code = `
            (() => {
                const el = document.querySelector('#prompt-textarea');
                if (!el) return 'no textarea';
                el.focus();
                // Clear existing
                el.innerHTML = '<p>test message from cdp</p>';
                el.dispatchEvent(new Event('input', { bubbles: true }));
                const sendBtn = document.querySelector('button[data-testid="send-button"]');
                return JSON.stringify({
                    text: el.innerText,
                    sendBtnDisabled: sendBtn?.disabled,
                    sendBtnClass: sendBtn?.className
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
        console.log('Insert text test:', JSON.parse(e.data).result?.result?.value);
        ws.close();
    };
})();
