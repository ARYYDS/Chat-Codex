# Create VSS shadow copy of C:
$s = (Get-WmiObject -List Win32_ShadowCopy).Create("C:\", "ClientAccessible")
$shadow = Get-WmiObject Win32_ShadowCopy | Where-Object { $_.ID -eq $s.ShadowID }
$vol = $shadow.DeviceObject + "\"

Write-Host "Shadow Volume: $vol"

# Copy live Cookies and Local State to a temp inspect dir
$inspectDir = "C:\code\Chat-Codex\inspect_live"
if (-not (Test-Path $inspectDir)) { New-Item -ItemType Directory -Path $inspectDir -Force | Out-Null }

$username = if ($env:USERNAME) { $env:USERNAME } else { "User" }
cmd.exe /c "copy /y `"$vol\Users\$username\AppData\Local\Google\Chrome\User Data\Default\Network\Cookies`" `"$inspectDir\Cookies`""
cmd.exe /c "copy /y `"$vol\Users\$username\AppData\Local\Google\Chrome\User Data\Local State`" `"$inspectDir\Local State`""

# List indexeddb folders in live Chrome
cmd.exe /c "dir `"$vol\Users\$username\AppData\Local\Google\Chrome\User Data\Default\IndexedDB`""

# Delete shadow copy
$shadow.Delete()
Write-Host "Shadow deleted."
