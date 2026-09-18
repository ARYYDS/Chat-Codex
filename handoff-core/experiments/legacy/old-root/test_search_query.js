(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.id === '5752AA4CFA65D73DF9690F3E0CDD865B');
    if (!page) {
        console.error('Target tab not found');
        return;
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        const code = `
            (() => {
                const el = document.querySelector('#prompt-textarea');
                if (!el) return 'no textarea';
                el.focus();
                el.innerHTML = '<p>请联网搜索：2026年最新发布的深度强化学习与大模型Agent协同架构有哪些重要突破？请详细分析并列出主要文献或框架。</p>';
                el.dispatchEvent(new Event('input', { bubbles: true }));
                
                setTimeout(() => {
                    const btn = document.querySelector('button[data-testid="send-button"]');
                    if (btn) btn.click();
                }, 300);
                
                return 'dispatched';
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
        console.log('Dispatch result:', JSON.parse(e.data).result?.result?.value);
        ws.close();
    };
})();
