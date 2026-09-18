(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        const code = `
            (async () => {
                // Find scripts loaded on the page
                const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
                const powScripts = [];
                for (const src of scripts) {
                    try {
                        const txt = await fetch(src).then(r => r.text());
                        if (txt.includes('proofofwork') || txt.includes('difficulty') || txt.includes('sentinel')) {
                            powScripts.push(src);
                        }
                    } catch(e) {}
                }
                return JSON.stringify({
                    totalScripts: scripts.length,
                    matchingScripts: powScripts
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
