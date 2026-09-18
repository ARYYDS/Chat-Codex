@echo off
title Sub-Instance 2 (Port 9223)
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9223 --remote-debugging-address=127.0.0.1 --user-data-dir="C:\code\Chat-Codex\sub-instance-2" --disable-component-update --disable-features=OptimizationGuideModelDownloading,OnDeviceTailModel,OptimizationHints --disable-background-networking --disk-cache-size=10485760 --no-first-run --no-default-browser-check --hide-crash-restore-bubble "https://chatgpt.com"
