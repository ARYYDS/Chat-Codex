'use strict';
# Python script to launch Chrome on WinSta0\Default interactive desktop
import sys
import os
import ctypes
from ctypes import wintypes

class STARTUPINFO(ctypes.Structure):
    _fields_ = [
        ('cb', wintypes.DWORD),
        ('lpReserved', wintypes.LPWSTR),
        ('lpDesktop', wintypes.LPWSTR),
        ('lpTitle', wintypes.LPWSTR),
        ('dwX', wintypes.DWORD),
        ('dwY', wintypes.DWORD),
        ('dwXSize', wintypes.DWORD),
        ('dwYSize', wintypes.DWORD),
        ('dwXCountChars', wintypes.DWORD),
        ('dwYCountChars', wintypes.DWORD),
        ('dwFillAttribute', wintypes.DWORD),
        ('dwFlags', wintypes.DWORD),
        ('wShowWindow', wintypes.WORD),
        ('cbReserved2', wintypes.WORD),
        ('lpReserved2', ctypes.c_char_p),
        ('hStdInput', wintypes.HANDLE),
        ('hStdOutput', wintypes.HANDLE),
        ('hStdError', wintypes.HANDLE),
    ]

class PROCESS_INFORMATION(ctypes.Structure):
    _fields_ = [
        ('hProcess', wintypes.HANDLE),
        ('hThread', wintypes.HANDLE),
        ('dwProcessId', wintypes.DWORD),
        ('dwThreadId', wintypes.DWORD),
    ]

si = STARTUPINFO()
si.cb = ctypes.sizeof(STARTUPINFO)
si.lpDesktop = 'WinSta0\\Default'
si.dwFlags = 1  # STARTF_USESHOWWINDOW
si.wShowWindow = 1  # SW_SHOWNORMAL (Visible)

pi = PROCESS_INFORMATION()

chrome_exe = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
args = [
    f'"{chrome_exe}"',
    '--remote-debugging-port=9225',
    '--remote-debugging-address=127.0.0.1',
    r'--user-data-dir="C:\GPT-Chat-codex-handoff\master-seed-profile"',
    '--disable-component-update',
    '--disable-features=OptimizationGuideModelDownloading,OnDeviceTailModel,OptimizationHints',
    '--disable-background-networking',
    '--disk-cache-size=10485760',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-crash-restore-bubble',
    '"https://chatgpt.com"'
]

cmdline = ' '.join(args)
print(f'[Launch Master] Launching Chrome on WinSta0\\Default: {cmdline}')

CREATE_NEW_PROCESS_GROUP = 0x00000200
DETACHED_PROCESS = 0x00000008

success = ctypes.windll.kernel32.CreateProcessW(
    None,
    cmdline,
    None,
    None,
    False,
    CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS,
    None,
    None,
    ctypes.byref(si),
    ctypes.byref(pi)
)

if not success:
    err = ctypes.GetLastError()
    print(f'[Launch Master FAILED] CreateProcessW error code: {err}')
    sys.exit(1)

print(f'[Launch Master SUCCESS] Started Chrome PID: {pi.dwProcessId} on WinSta0\\Default')
ctypes.windll.kernel32.CloseHandle(pi.hProcess)
ctypes.windll.kernel32.CloseHandle(pi.hThread)
