@echo off
chcp 65001 >nul
title WebChat-Assistant Desktop Launcher

echo ====================================================================
echo  🚀 WebChat-Assistant 桌面轻量化客户端启动器
echo ====================================================================

set "SCRIPT_DIR=%~dp0"
set "GUI_PORT=8765"
set "PROFILE_DIR=C:\GPT-Chat-codex-handoff\gui-app-profile"
set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"

if not exist "%CHROME_EXE%" (
    if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
        set "CHROME_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    ) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
        set "CHROME_EXE=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
    )
)

if not exist "%PROFILE_DIR%" (
    mkdir "%PROFILE_DIR%" 2>nul
)

set "TAURI_EXE=%SCRIPT_DIR%webchat-assistant.exe"
if not exist "%TAURI_EXE%" (
    set "TAURI_EXE=%SCRIPT_DIR%src-tauri\target\release\webchat-assistant.exe"
)

echo [1/2] 正在拉起 WebChat-Assistant 后台服务 (Port: %GUI_PORT%)...
cd /d "%SCRIPT_DIR%"
start "WebChat-Assistant Service" /min cmd /c "node bin\assistant.js gui --port %GUI_PORT% --no-open"

echo [2/2] 正在启动客户端界面...
ping -n 3 127.0.0.1 >nul

if exist "%TAURI_EXE%" (
    echo [原生客户端] 启动 Tauri 2.0 原生独立桌面应用视窗...
    start "" "%TAURI_EXE%"
) else if exist "%CHROME_EXE%" (
    echo [浏览器窗口] 启动 Chrome 原生应用窗口模式...
    start "" "%CHROME_EXE%" --app=http://127.0.0.1:%GUI_PORT% --window-size=1440,900 --user-data-dir="%PROFILE_DIR%"
) else (
    echo [警告] 未检测到 Chrome 可执行文件，尝试使用系统默认浏览器打开...
    start http://127.0.0.1:%GUI_PORT%
)

echo ✅ WebChat-Assistant 启动就绪！
