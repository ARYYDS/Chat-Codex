(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        ws.send(JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: {
                expression: 'fetch("/backend-api/sentinel/chat-requirements", {method: "POST", headers: {"Content-Type": "application/json"}, body: "{}"}).then(r => r.json())',
                returnByValue: true,
                awaitPromise: true
            }
        }));
    };
    ws.onmessage = (e) => {
        const res = JSON.parse(e.data);
        console.log(JSON.stringify(res.result?.result?.value, null, 2));
        ws.close();
    };
})();
