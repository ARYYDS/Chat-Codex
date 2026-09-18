# Fresh copy from inspect_live to test_profile
$testDir = "C:\code\Chat-Codex\test_profile"
if (Test-Path $testDir) { Remove-Item $testDir -Recurse -Force }
New-Item -ItemType Directory -Path "$testDir\Default\Network" -Force | Out-Null
Copy-Item "C:\code\Chat-Codex\inspect_live\Local State" "$testDir\Local State" -Force
Copy-Item "C:\code\Chat-Codex\inspect_live\Cookies" "$testDir\Default\Network\Cookies" -Force

# Run Chrome with logging and exit after 5s
$logPath = "C:\code\Chat-Codex\test_decrypt.log"
if (Test-Path $logPath) { Remove-Item $logPath -Force }

$cmd = "& 'C:\Program Files\Google\Chrome\Application\chrome.exe' --user-data-dir=`"$testDir`" --enable-logging=stderr --v=1 --log-file=`"$logPath`" 'https://chatgpt.com'"
$p = Start-Process -FilePath "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList @(
    "--user-data-dir=$testDir",
    "--enable-logging=stderr",
    "--v=1",
    "--log-file=$logPath",
    "--no-first-run",
    "--no-default-browser-check",
    "https://chatgpt.com"
) -PassThru

Start-Sleep -Seconds 4
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue

# Check what happened to Cookies
python -c "
import sqlite3
conn = sqlite3.connect(r'$testDir\Default\Network\Cookies')
c = conn.cursor()
c.execute('SELECT count(*) FROM cookies')
print('Remaining cookies in test_profile:', c.fetchone()[0])
"
