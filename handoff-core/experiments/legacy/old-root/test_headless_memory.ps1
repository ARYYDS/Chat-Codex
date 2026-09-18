# Test launch Sub-Instance 1 in Headless Mode on port 9224
$testDir = "C:\code\Chat-Codex\test-headless"
if (Test-Path $testDir) { Remove-Item $testDir -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Path "$testDir\Default\Network" -Force | Out-Null

Copy-Item "C:\code\Chat-Codex\sub-instance-1\Local State" "$testDir\Local State" -Force
Copy-Item "C:\code\Chat-Codex\sub-instance-1\Default\Network\Cookies" "$testDir\Default\Network\Cookies" -Force
if (Test-Path "C:\code\Chat-Codex\sub-instance-1\Default\Local Storage") {
    robocopy "C:\code\Chat-Codex\sub-instance-1\Default\Local Storage" "$testDir\Default\Local Storage" /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
}

$args = @(
    "--remote-debugging-port=9224",
    "--user-data-dir=$testDir",
    "--headless=new",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-extensions",
    "--disable-component-update",
    "--disable-background-networking",
    "--disk-cache-size=10485760",
    "--no-first-run",
    "--no-default-browser-check",
    "https://chatgpt.com"
)

$p = Start-Process -FilePath "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList $args -PassThru
Start-Sleep -Seconds 5

# Check memory of this headless instance
$procs = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq "chrome.exe" -and $_.CommandLine -like "*test-headless*"
}
$totalWS = 0
$totalPM = 0
foreach ($pr in $procs) {
    $gp = Get-Process -Id $pr.ProcessId -ErrorAction SilentlyContinue
    if ($gp) {
        $totalWS += $gp.WorkingSet64
        $totalPM += $gp.PrivateMemorySize64
        Write-Host "PID $($pr.ProcessId) Type: $(($pr.CommandLine -split '--type=')[1] -replace ' .*','') WS: $([math]::Round($gp.WorkingSet64/1MB,1))MB"
    }
}
Write-Host "=========================================="
Write-Host "HEADLESS TOTAL MEMORY: $([math]::Round($totalWS/1MB,2)) MB (Processes: $($procs.Count))"
Write-Host "=========================================="

# Check if CDP works on 9224 and is logged in
node -e "
(async () => {
    try {
        const v = await fetch('http://127.0.0.1:9224/json/version').then(r => r.json());
        const ws = new WebSocket(v.webSocketDebuggerUrl);
        ws.onopen = () => {
            ws.send(JSON.stringify({ id: 1, method: 'Storage.getCookies' }));
        };
        ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            const cookies = data.result?.cookies || [];
            const session = cookies.find(c => c.name.includes('session-token'));
            console.log('Headless Port 9224: Total cookies = ' + cookies.length + ', Session-token = ' + (session ? 'YES' : 'NO'));
            ws.send(JSON.stringify({ id: 2, method: 'Browser.close' }));
            setTimeout(() => ws.close(), 1000);
        };
    } catch(err) {
        console.error(err);
    }
})();
"
Start-Sleep -Seconds 3
if (Test-Path $testDir) { Remove-Item $testDir -Recurse -Force -ErrorAction SilentlyContinue }
