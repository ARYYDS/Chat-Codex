$src = "C:\code\Chat-Codex\cloned-profile-slim"
$dst = "C:\code\Chat-Codex\test_clone_v10"

if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
New-Item -ItemType Directory -Path "$dst\Default\Network" -Force | Out-Null

Copy-Item "$src\Local State" "$dst\Local State" -Force
Copy-Item "$src\Default\Network\Cookies" "$dst\Default\Network\Cookies" -Force

# Launch Chrome on test_clone_v10 on port 9223
$cmd = '"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9223 --user-data-dir="C:\code\Chat-Codex\test_clone_v10" --no-first-run --no-default-browser-check --headless=new'
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c $cmd" -PassThru
Start-Sleep -Seconds 3

# Check if CDP on 9223 sees test_abe_check!
node -e "
(async () => {
    try {
        const v = await fetch('http://127.0.0.1:9223/json/version').then(r => r.json());
        const ws = new WebSocket(v.webSocketDebuggerUrl);
        ws.onopen = () => {
            ws.send(JSON.stringify({ id: 1, method: 'Storage.getCookies' }));
        };
        ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            const cookies = data.result?.cookies || [];
            console.log('Total cookies in cloned test_clone_v10:', cookies.length);
            const found = cookies.find(c => c.name === 'test_abe_check');
            console.log('test_abe_check found in clone?:', found ? 'YES! 100% PERSISTED ACROSS CLONE!' : 'NO!');
            ws.send(JSON.stringify({ id: 2, method: 'Browser.close' }));
            setTimeout(() => ws.close(), 1000);
        };
    } catch(err) {
        console.error(err);
    }
})();
"
