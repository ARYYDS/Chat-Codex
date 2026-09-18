$s = (Get-WmiObject -List Win32_ShadowCopy).Create("C:\", "ClientAccessible")
$shadow = Get-WmiObject Win32_ShadowCopy | Where-Object { $_.ID -eq $s.ShadowID }
$vol = $shadow.DeviceObject + "\"

$link = "C:\vss_full_link"
if (Test-Path $link) { cmd.exe /c "rmdir $link" }
cmd.exe /c "mklink /d $link `"$vol`""

$username = if ($env:USERNAME) { $env:USERNAME } else { "User" }
$src = "$link\Users\$username\AppData\Local\Google\Chrome\User Data"
$dst = "C:\code\Chat-Codex\cloned-profile-full"

if (Test-Path $dst) { Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Path $dst -Force | Out-Null

Write-Host "Robocopying entire User Data excluding Cache and Code Cache..."
# Exclude Cache, Code Cache, DawnGraphiteCache, GPUCache to keep size small but keep all state
robocopy "$src" "$dst" /E /XD "Cache" "Code Cache" "DawnGraphiteCache" "GPUCache" "GrShaderCache" "ShaderCache" "Crashpad" /R:1 /W:1 /NFL /NDL /NJH /NJS

cmd.exe /c "rmdir $link"
$shadow.Delete()
Write-Host "Full clone complete!"
