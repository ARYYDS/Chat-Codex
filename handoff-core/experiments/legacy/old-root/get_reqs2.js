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
                    fetch("/backend-api/sentinel/chat-requirements", {
                        method: "POST",
                        headers: {"Content-Type": "application/json"},
                        body: "{}"
                    })
                    .then(r => r.json())
                    .then(d => JSON.stringify({
                        persona: d.persona,
                        token_prefix: d.token ? d.token.slice(0, 40) : null,
                        proofofwork_required: !!d.proofofwork?.required,
                        proofofwork_difficulty: d.proofofwork?.difficulty,
                        proofofwork_seed: d.proofofwork?.seed,
                        turnstile_required: !!d.turnstile?.required,
                        arkose_required: !!d.arkose?.required
                    }))
                `,
                returnByValue: true,
                awaitPromise: true
            }
        }));
    };
    ws.onmessage = (e) => {
        const res = JSON.parse(e.data);
        console.log('Requirements Result:', res.result?.result?.value);
        ws.close();
    };
})();
