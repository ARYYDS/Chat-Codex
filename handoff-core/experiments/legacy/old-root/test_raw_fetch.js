(async () => {
    // 1. Get cookies from Chrome via CDP
    const v = await fetch('http://127.0.0.1:9222/json/version').then(r => r.json());
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    
    let cookiesStr = '';
    await new Promise((resolve) => {
        ws.onopen = () => {
            ws.send(JSON.stringify({ id: 1, method: 'Storage.getCookies' }));
        };
        ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            const cookies = data.result?.cookies || [];
            cookiesStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
            ws.close();
            resolve();
        };
    });

    console.log(`Extracted ${cookiesStr.split(';').length} cookies from Chrome.`);

    // 2. Attempt raw Node.js fetch to https://chatgpt.com/api/auth/session
    console.log('\n--- Attempting raw Node.js fetch (No Chrome, OpenSSL TLS, Node headers) ---');
    try {
        const resp = await fetch('https://chatgpt.com/api/auth/session', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
                'Cookie': cookiesStr,
                'Accept': '*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
            }
        });
        console.log('HTTP Status Code:', resp.status);
        console.log('Response Headers:', Object.fromEntries(resp.headers.entries()));
        const text = await resp.text();
        console.log('Response Body Snippet:', text.slice(0, 300));
    } catch(err) {
        console.error('Fetch error:', err);
    }
})();
