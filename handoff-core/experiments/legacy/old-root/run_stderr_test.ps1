# Prepare a fresh test directory with Local State and Cookies from inspect_live
$t = "C:\code\Chat-Codex\test_stderr"
if (Test-Path $t) { Remove-Item $t -Recurse -Force }
New-Item -ItemType Directory -Path "$t\Default\Network" -Force | Out-Null
Copy-Item "C:\code\Chat-Codex\inspect_live\Local State" "$t\Local State" -Force
Copy-Item "C:\code\Chat-Codex\inspect_live\Cookies" "$t\Default\Network\Cookies" -Force

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$psi.Arguments = "--user-data-dir=`"$t`" --enable-logging=stderr --v=1 --no-first-run --no-default-browser-check https://chatgpt.com"
$psi.UseShellExecute = $false
$psi.RedirectStandardError = $true
$psi.RedirectStandardOutput = $true
$psi.CreateNoWindow = $true

$p = [System.Diagnostics.Process]::Start($psi)
Start-Sleep -Seconds 4
if (-not $p.HasExited) { $p.Kill() }

$err = $p.StandardError.ReadToEnd()
Write-Host "STDERR OUTPUT:"
$err | Select-String -Pattern "app_bound|encrypt|cookie|elevator|decrypt" -Context 1,1
