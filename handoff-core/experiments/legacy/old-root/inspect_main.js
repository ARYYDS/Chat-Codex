(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.id === '5752AA4CFA65D73DF9690F3E0CDD865B');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        const code = `
            (() => {
                const main = document.querySelector('main');
                const divs = Array.from(main?.querySelectorAll('[data-message-author-role]') || []);
                return JSON.stringify({
                    mainFound: !!main,
                    rolesFound: divs.map(d => ({
                        role: d.getAttribute('data-message-author-role'),
                        class: d.className,
                        text: d.innerText.slice(0, 400)
                    })),
                    mainText: main?.innerText?.slice(0, 1000)
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
        console.log(JSON.parse(e.data).result?.result?.value);
        ws.close();
    };
})();
