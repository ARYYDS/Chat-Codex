(async () => {
    const browserWsUrl = await fetch('http://127.0.0.1:9222/json/version').then(r => r.json()).then(d => d.webSocketDebuggerUrl);
    const ws = new WebSocket(browserWsUrl);
    
    const targetId = await new Promise((resolve) => {
        ws.onopen = () => {
            ws.send(JSON.stringify({
                id: 1,
                method: 'Target.createTarget',
                params: { url: 'https://chatgpt.com/' }
            }));
        };
        ws.onmessage = (e) => {
            const res = JSON.parse(e.data);
            resolve(res.result?.targetId);
        };
    });
    console.log('Created tab:', targetId);

    // Connect to tab
    const tabWs = new WebSocket(`ws://127.0.0.1:9222/devtools/page/${targetId}`);
    await new Promise(r => tabWs.onopen = r);
    
    // Poll for #prompt-textarea
    let ready = false;
    const start = Date.now();
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        const res = await new Promise((resolve) => {
            const reqId = Date.now();
            tabWs.send(JSON.stringify({
                id: reqId,
                method: 'Runtime.evaluate',
                params: {
                    expression: `(() => {
                        const el = document.querySelector('#prompt-textarea');
                        const send = document.querySelector('button[data-testid="send-button"]');
                        return { hasTextarea: !!el, hasSend: !!send };
                    })()`,
                    returnByValue: true
                }
            }));
            const handler = (e) => {
                const data = JSON.parse(e.data);
                if (data.id === reqId) {
                    tabWs.removeEventListener('message', handler);
                    resolve(data.result?.result?.value);
                }
            };
            tabWs.addEventListener('message', handler);
        });
        if (res?.hasTextarea) {
            console.log(`Textarea ready after ${Date.now() - start}ms!`);
            ready = true;
            break;
        }
    }
    
    // Close tab
    ws.send(JSON.stringify({
        id: 2,
        method: 'Target.closeTarget',
        params: { targetId }
    }));
    await new Promise(r => setTimeout(r, 500));
    tabWs.close();
    ws.close();
    console.log('Tab closed, test complete, ready =', ready);
})();
