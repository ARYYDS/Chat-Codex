(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        const code = `
            (() => {
                const textarea = document.querySelector('#prompt-textarea');
                const sendBtn = document.querySelector('button[data-testid="send-button"]') || 
                                document.querySelector('button[aria-label="Send prompt"]') ||
                                document.querySelector('button[aria-label="发送提示"]');
                return JSON.stringify({
                    hasTextarea: !!textarea,
                    textareaTag: textarea ? textarea.tagName : null,
                    textareaPlaceholder: textarea ? (textarea.placeholder || textarea.getAttribute('placeholder') || textarea.innerText) : null,
                    hasSendBtn: !!sendBtn,
                    buttons: Array.from(document.querySelectorAll('button')).map(b => ({
                        testid: b.getAttribute('data-testid'),
                        ariaLabel: b.getAttribute('aria-label'),
                        text: b.innerText.trim().slice(0, 30)
                    })).filter(b => b.testid || b.ariaLabel || b.text)
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
        console.log('DOM elements:', JSON.parse(e.data).result?.result?.value);
        ws.close();
    };
})();
