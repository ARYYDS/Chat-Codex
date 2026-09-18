(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.type === 'page');
    console.log('Testing in-browser fetch via CDP on page:', page.title);

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        ws.send(JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: {
                expression: 'fetch("/api/auth/session").then(r => r.json()).then(d => JSON.stringify({email: d.user?.email, id: d.user?.id, expires: d.expires, hasAccessToken: !!d.accessToken}))',
                awaitPromise: true
            }
        }));
    };
    ws.onmessage = (e) => {
        const res = JSON.parse(e.data);
        console.log('Real Chrome Session Response:', res.result?.result?.value);
        ws.close();
    };
})();
