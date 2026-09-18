# Start slim Chrome, set a cookie via CDP, wait 5s for flush, then check encryption prefix on disk
schtasks /create /tn "LaunchChatGPT" /tr "C:\code\Chat-Codex\start_chatgpt_slim.bat" /sc once /st "00:00" /it /f
schtasks /run /tn "LaunchChatGPT"
Start-Sleep -Seconds 3
schtasks /delete /tn "LaunchChatGPT" /f

node -e "
(async () => {
    const v = await fetch('http://127.0.0.1:9222/json/version').then(r => r.json());
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    ws.onopen = () => {
        ws.send(JSON.stringify({
            id: 1,
            method: 'Storage.setCookies',
            params: {
                cookies: [{
                    name: 'test_abe_check',
                    value: 'secret_123',
                    domain: '.chatgpt.com',
                    path: '/',
                    expires: Math.floor(Date.now() / 1000) + 86400
                }]
            }
        }));
    };
    ws.onmessage = (e) => {
        console.log('SetCookie response:', e.data);
        // Navigate to trigger storage commit
        ws.send(JSON.stringify({ id: 2, method: 'Page.navigate', params: { url: 'https://chatgpt.com/' } }));
        setTimeout(() => ws.close(), 1000);
    };
})();
"
Start-Sleep -Seconds 5
