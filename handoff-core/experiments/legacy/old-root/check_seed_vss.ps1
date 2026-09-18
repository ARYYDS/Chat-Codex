$s = (Get-WmiObject -List Win32_ShadowCopy).Create("C:\", "ClientAccessible")
$shadow = Get-WmiObject Win32_ShadowCopy | Where-Object { $_.ID -eq $s.ShadowID }
$vol = $shadow.DeviceObject + "\"

$link = "C:\vss_seed_link"
if (Test-Path $link) { cmd.exe /c "rmdir $link" }
cmd.exe /c "mklink /d $link `"$vol`""

$src = "$link\GPT-Chat-codex-handoff\master-seed-profile"
$tempInspect = "C:\code\Chat-Codex\inspect_seed"
if (-not (Test-Path $tempInspect)) { New-Item -ItemType Directory -Path $tempInspect -Force | Out-Null }

Copy-Item "$src\Local State" "$tempInspect\Local State" -Force
Copy-Item "$src\Default\Network\Cookies" "$tempInspect\Cookies" -Force

cmd.exe /c "rmdir $link"
$shadow.Delete()

python -c "
import sqlite3
conn = sqlite3.connect(r'C:\code\Chat-Codex\inspect_seed\Cookies')
c = conn.cursor()
c.execute('SELECT count(*) FROM cookies')
print('Total cookies in Master Seed:', c.fetchone()[0])
c.execute('SELECT name, substr(encrypted_value, 1, 3) FROM cookies WHERE host_key LIKE ''%chatgpt%''')
for r in c.fetchall():
    print(r)
"
