@echo off
title ChatGPT Slim Profile (9222)
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\code\Chat-Codex\cloned-profile-slim" --disable-component-update --disable-features=OptimizationGuideModelDownloading,OnDeviceTailModel,OptimizationHints --disable-background-networking --disk-cache-size=10485760 --no-first-run --no-default-browser-check --hide-crash-restore-bubble "https://chatgpt.com"
