# 模块四：Windows 进程生命周期、Job Object 与桌面穿透 (Windows Process & Desktop)

本文档是 Chat-Codex 系统在 **Windows 操作系统底层** 的进程生命周期管理、Win32 Job Object 作业对象隔离、Session 0 桌面穿透与看门狗治理规范。

---

## 1. Windows 进程生命周期与作业对象 (Job Object) 隔离

### 1.1 级联终止的根源剖析
在 Windows 环境下，开发人员常遇到“关闭终端会话或重启 IDE 时，后台运行的 Chrome 实例被意外级联杀死”的现象。其根本原因并非单纯的父子进程关系，而是以下三种系统机制叠加：
1. **控制台事件广播**：父控制台关闭时向进程组广播 `CTRL_CLOSE_EVENT`；
2. **作业对象限制**：IDE 或终端管理器常驻在设置了 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 的 Job Object 中，当最后一个作业句柄关闭时，内核强制终止该 Job 内的所有后代进程；
3. **IDE 主动进程树清理**：现代 IDE 在退出时会主动遍历进程树，调用 `TerminateProcess` 清理派生的子进程。

### 1.2 现代 Win32 启动隔离标准 (`PROC_THREAD_ATTRIBUTE_JOB_LIST`)
传统的“创建挂起进程 -> 调用 `AssignProcessToJobObject` -> 恢复线程”存在脆弱的时间窗口（若启动器在加入 Job 前崩溃，会遗留不可控的孤儿进程）。

**2026 生产级标准**：在 Windows 10/11 上，优先采用扩展属性列表在创建时原子绑定独立 `browserJob`：

```cpp
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <string>

// 生产级安全启动函数：使用 PROC_THREAD_ATTRIBUTE_JOB_LIST 原子绑定
DWORD LaunchChromeInJob(
    HANDLE browserJob,
    const std::wstring& absoluteExe,
    std::wstring commandLine,
    PROCESS_INFORMATION& out)
{
    out = {};
    SIZE_T bytes = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &bytes);
    
    auto attrs = static_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(HeapAlloc(GetProcessHeap(), 0, bytes));
    if (!attrs) return ERROR_NOT_ENOUGH_MEMORY;

    InitializeProcThreadAttributeList(attrs, 1, 0, &bytes);

    // 将独立的 browserJob 传入属性列表
    HANDLE jobs[] = { browserJob };
    UpdateProcThreadAttribute(attrs, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST, jobs, sizeof(jobs), nullptr, nullptr);

    STARTUPINFOEXW si{};
    si.StartupInfo.cb = sizeof(si);
    si.lpAttributeList = attrs;

    PROCESS_INFORMATION pi{};
    DWORD flags = EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | DETACHED_PROCESS;

    BOOL created = CreateProcessW(
        absoluteExe.c_str(),
        commandLine.data(),
        nullptr, nullptr,
        FALSE, // 严禁继承 IDE 或宿主的非相关句柄
        flags,
        nullptr, nullptr,
        &si.StartupInfo,
        &pi);

    DeleteProcThreadAttributeList(attrs);
    HeapFree(GetProcessHeap(), 0, attrs);

    if (!created) return GetLastError();

    // 恢复主线程
    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);
    out = pi;
    return ERROR_SUCCESS;
}
```

### 1.3 嵌套作业对象 (Nested Jobs) 兼容规范
Chromium 内部的多进程沙箱模型依赖于 Windows 8+ 引入的**嵌套作业对象（Nested Jobs）**机制：
- 宿主创建的外层 `browserJob` **严禁施加过小的活动进程数上限或不当的 UI 限制**，确保 Chromium 能够自由为其 Renderer、GPU 与 Utility 进程派生子 Job；
- `KILL_ON_JOB_CLOSE` 标志仅授予 Worker 专属 Job，不建议随意施加给全局浏览器宿主 Job。

---

## 2. 传输通道与本地 IPC 权衡：TCP 127.0.0.1 vs `--remote-debugging-pipe`

### 2.1 Chromium 调试管道 EOF 自动退出机制
经对 Chromium 源码（`devtools_pipe_handler.cc` 与 `remote_debugging_server.cc`）审查确认：
- `--remote-debugging-pipe` 模式使用匿名管道，**当管道读取端检测到 EOF（即对端进程退出或关闭管道）时，Chromium 内部会直接触发 `CloseBrowserSoon` 终止自身**；
- **结论**：若由易重启的 IDE 或 Broker 直接持有管道句柄，IDE 退出时 Chrome 将被自身回调直接关闭。因此，**调试管道模式无法用于跨 IDE 重启的长程保活场景**。

### 2.2 传输选型决策矩阵

| 场景链路 | 推荐传输技术 | 核心技术理由与安全措施 |
|---|---|---|
| **Keeper ↔ Chrome 调试通道** | **环回 TCP / WebSocket** (`127.0.0.1`) | 支持 Keeper 重启后通过 Target 重新 attach 已在运行的 Chrome。配合 `--remote-debugging-port=0` 动态分配端口，读取 `DevToolsActivePort` 避免端口冲突。 |
| **Agent / IDE ↔ Keeper 通信** | **自建 Named Pipe IPC** | 采用显式受限 DACL、`PIPE_REJECT_REMOTE_CLIENTS` 与 IOCP 异步 I/O，杜绝本地端口扫描与未授权进程探测。 |

---

## 3. Windows Session 0 隔离穿透与交互桌面绑定

### 3.1 Session 0 隔离的危害
在 Windows 服务、CI/CD 自动化代理或后台任务中派生进程时，默认运行于无 GUI 的 Session 0：
- 导致 GDI 桌面句柄为空、Direct3D/ANGLE 硬件加速设备创建失败；
- 页面无法完成有效水合渲染，或触发不可见的弹窗死锁。

### 3.2 `WinSta0\Default` 穿透标准
1. **P/Invoke 显式指定交互桌面**：
   在派生子进程的 `STARTUPINFO` 结构体中显式声明：
   ```csharp
   si.lpDesktop = @"WinSta0\Default";
   ```
2. **非特权交互穿透**：
   在交互式运维脚本中，使用 `schtasks /create /it /ru "%USERNAME%"` 创建即时任务，确保 Worker 窗口挂载到当前活动用户的图形桌面。

---

## 4. 看门狗守卫与 Windows 进程树硬杀 (`process-tree-guard.js`)

Node.js 原生 `child.kill()` 在 Windows 下仅终止顶层 CMD/PowerShell 外壳，会遗留大量孤儿 Chrome 进程，造成 SQLite 数据库锁死。

### 进程树硬杀实现标准
看门狗必须调用 Windows 原生 `taskkill /T /F`，遍历整棵进程子树：
```javascript
function terminateProcessTree(pid) {
    try {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}
```
结合超时熔断机制，在单测死循环或浏览器卡死时，确保主工作区与沙盒工作树内的句柄被 100% 释放。
