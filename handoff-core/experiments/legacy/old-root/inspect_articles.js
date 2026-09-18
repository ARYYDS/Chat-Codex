(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.id === '5752AA4CFA65D73DF9690F3E0CDD865B');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        const code = `
            (() => {
                const articles = Array.from(document.querySelectorAll('article'));
                return JSON.stringify({
                    articleCount: articles.length,
                    articles: articles.map(a => ({
                        role: a.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role'),
                        text: a.innerText.slice(0, 300)
                    }))
                }, null, 2);
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
        console.log('Article details:');
        console.log(JSON.parse(e.data).result?.result?.value);
        ws.close();
    };
})();
