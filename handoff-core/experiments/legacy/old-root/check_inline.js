(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        const code = `
            (async () => {
                const scripts = Array.from(document.querySelectorAll('script')).map(s => s.src || s.innerText);
                let found = [];
                for (let i = 0; i < scripts.length; i++) {
                    const s = scripts[i];
                    if (s.includes('generateAnswer') || s.includes('difficulty') || s.includes('proof-of-work')) {
                        found.push(i);
                    }
                }
                return JSON.stringify({
                    inlineScriptsCount: scripts.length,
                    found
                });
            })()
        `;
        ws.send(JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: {
                expression: code,
                returnByValue: true,
                awaitPromise: true
            }
        }));
    };
    ws.onmessage = (e) => {
        console.log(JSON.parse(e.data).result?.result?.value);
        ws.close();
    };
})();
