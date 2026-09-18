(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        ws.send(JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: {
                expression: `
                    fetch("/backend-api/models")
                    .then(r => r.json())
                    .then(d => JSON.stringify({
                        models: d.models?.map(m => m.slug),
                        categories: d.categories
                    }))
                `,
                returnByValue: true,
                awaitPromise: true
            }
        }));
    };
    ws.onmessage = (e) => {
        const res = JSON.parse(e.data);
        console.log('Models Response:', res.result?.result?.value);
        ws.close();
    };
})();
