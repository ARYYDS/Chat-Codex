@echo off
chcp 65001 >nul
title Worker 1 Automation Sandbox (Port 9222)
set "PROFILE_DIR=C:\code\Chat-Codex\sub-instance-1"
set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"

echo 🚀 正在启动 Worker 1 运行时沙盒浏览器 (Port: 9222)...
start "" "%CHROME_EXE%" --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --user-data-dir="%PROFILE_DIR%" --disable-component-update --disable-features=OptimizationGuideModelDownloading,OnDeviceTailModel,OptimizationHints --disable-background-networking --disk-cache-size=10485760 --no-first-run --no-default-browser-check --hide-crash-restore-bubble "https://chatgpt.com"
