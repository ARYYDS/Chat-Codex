(async () => {
    // 1. Get session info and accessToken from /api/auth/session
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    
    let sessionData = null;
    await new Promise((resolve) => {
        ws.onopen = () => {
            ws.send(JSON.stringify({
                id: 1,
                method: 'Runtime.evaluate',
                params: {
                    expression: 'fetch("/api/auth/session").then(r => r.json())',
                    returnByValue: true,
                    awaitPromise: true
                }
            }));
        };
        ws.onmessage = (e) => {
            const res = JSON.parse(e.data);
            sessionData = res.result?.result?.value;
            ws.close();
            resolve();
        };
    });

    const accessToken = sessionData?.accessToken;
    console.log('Access token obtained:', accessToken ? `${accessToken.slice(0, 20)}...` : 'None');

    // 2. Query /backend-api/sentinel/chat-requirements
    console.log('\n--- Querying /backend-api/sentinel/chat-requirements ---');
    try {
        const reqResp = await fetch('https://chatgpt.com/backend-api/sentinel/chat-requirements', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
            },
            body: JSON.stringify({})
        });
        console.log('Chat-requirements HTTP Status:', reqResp.status);
        const reqJson = await reqResp.json();
        console.log('Chat-requirements Response:', JSON.stringify(reqJson, null, 2));
    } catch(err) {
        console.error('Sentinel error:', err);
    }
})();
