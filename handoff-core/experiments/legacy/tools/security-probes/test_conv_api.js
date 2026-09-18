(async () => {
    const list = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
    const page = list.find(p => p.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => {
        const code = `
            (async () => {
                const session = await fetch('/api/auth/session').then(r => r.json());
                const reqs = await fetch('/backend-api/sentinel/chat-requirements', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + session.accessToken
                    },
                    body: '{}'
                }).then(r => r.json());

                function uuidv4() {
                    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                        return v.toString(16);
                    });
                }

                const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + session.accessToken,
                    'Openai-Sentinel-Chat-Requirements-Token': reqs.token
                };

                const body = {
                    action: 'next',
                    messages: [
                        {
                            id: uuidv4(),
                            author: { role: 'user' },
                            content: {
                                content_type: 'text',
                                parts: ['ping test 123']
                            },
                            metadata: {}
                        }
                    ],
                    parent_message_id: uuidv4(),
                    model: 'auto',
                    timezone_offset_min: -480,
                    history_and_training_disabled: true,
                    conversation_mode: { kind: 'primary_assistant' }
                };

                const res = await fetch('/backend-api/conversation', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(body)
                });

                let text = '';
                if (!res.ok) {
                    text = await res.text();
                } else {
                    const reader = res.body.getReader();
                    const decoder = new TextDecoder();
                    let count = 0;
                    while (count < 5) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        text += decoder.decode(value, { stream: true });
                        count++;
                    }
                    reader.cancel();
                }

                return JSON.stringify({
                    status: res.status,
                    statusText: res.statusText,
                    preview: text.slice(0, 500)
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
        console.log('Conversation API response:', JSON.parse(e.data).result?.result?.value);
        ws.close();
    };
})();
