(async () => {
    const browserWsUrl = await fetch('http://127.0.0.1:9222/json/version')
        .then(r => r.json())
        .then(d => d.webSocketDebuggerUrl);

    const ws = new WebSocket(browserWsUrl);
    ws.onopen = () => {
        ws.send(JSON.stringify({
            id: 1,
            method: 'Target.createTarget',
            params: {
                url: 'https://chatgpt.com/'
            }
        }));
    };
    ws.onmessage = (e) => {
        const res = JSON.parse(e.data);
        console.log('Created Target:', res);
        ws.close();
    };
})();
