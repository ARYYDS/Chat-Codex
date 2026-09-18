@echo off
chcp 65001 >nul
title Master-Seed Browser (Port 9225)
set "PROFILE_DIR=C:\GPT-Chat-codex-handoff\master-seed-profile"
set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"

if not exist "%PROFILE_DIR%" (
    mkdir "%PROFILE_DIR%" 2>nul
)

echo 🚀 正在启动 Master-Seed 母版沙盒浏览器 (Port: 9225)...
echo 📌 说明: 请在此视窗中完成 ChatGPT 登录，系统将自动嗅探并热同步凭据至 Worker。
start "" "%CHROME_EXE%" --remote-debugging-port=9225 --remote-debugging-address=127.0.0.1 --user-data-dir="%PROFILE_DIR%" --disable-component-update --disable-features=OptimizationGuideModelDownloading,OnDeviceTailModel,OptimizationHints --disable-background-networking --disk-cache-size=10485760 --no-first-run --no-default-browser-check --hide-crash-restore-bubble "https://chatgpt.com"
