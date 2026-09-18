(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        const code = `
            (async () => {
                const session = await fetch('/api/auth/session').then(r => r.json());
                const req = await fetch('/backend-api/sentinel/chat-requirements', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + session.accessToken
                    },
                    body: '{}'
                }).then(r => r.json());
                return JSON.stringify({
                    persona: req.persona,
                    turnstile_required: !!req.turnstile?.required,
                    proofofwork_required: !!req.proofofwork?.required,
                    proofofwork_difficulty: req.proofofwork?.difficulty,
                    proofofwork_seed: req.proofofwork?.seed,
                    token_len: req.token?.length
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
        console.log('Chat Reqs with Auth:', JSON.parse(e.data).result?.result?.value);
        ws.close();
    };
})();
