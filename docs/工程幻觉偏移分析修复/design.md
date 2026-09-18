# Chat-Codex 工程幻觉偏移深度分析、修复架构与测试标准规范
# (Engineering Hallucination Root-Cause Audit, Remediation Architecture & Testing Standards)

本文档针对 `Chat-Codex` 及其桌面 GUI 设计中暴露出的**六大工程实现幻觉（Happy-Path Hallucinations）**进行系统性根因解构，确立符合 Windows 操作系统安全模型、官方 MCP 协议标准与 Chrome CDP 底层机制的生产级修复架构，并建立严格的**自动化可验证测试标准**。

---

## 目录 (Table of Contents)

1. [六大工程幻觉问题溯源与底层机理解构](#1-六大工程幻觉问题溯源与底层机理解构)
   - 1.1 幻觉一：Windows VSS 卷影提权墙与 ABE v20 加密失效
   - 1.2 幻觉二：母版 9225 端口 CDP 探针诱发 Cloudflare Turnstile 封锁
   - 1.3 幻觉三：Stdio 挂起 60 秒与 IDE 客户端硬超时断链
   - 1.4 幻觉四：直接 Patch 工作区污染与 Windows 孤儿死循环进程
   - 1.5 幻觉五：Context7 一键安装假设与 JSONC / 路径配置分流盲区
   - 1.6 幻觉六：1Hz 高频 WMI 遥测引发系统资源雪崩
2. [生产级去幻觉修复架构设计](#2-生产级去幻觉修复架构设计)
   - 2.1 凭据热克隆：CDP Browser Target 内存直出与动态回填 (Zero-Admin)
   - 2.2 登录流程：Browser Target 隔离监听与人工放行保底
   - 2.3 人工介入：MCP 异步任务句柄模式 (Async Task Handle Pattern)
   - 2.4 自动化门禁：Git Worktree 影子物理隔离与进程树硬熔断
   - 2.5 客户端安装：JSONC 容错解析、绝对路径绑定与语法分流
   - 2.6 系统遥测：Win32 API 原生直读与 CDP 事件驱动
3. [全量可执行测试标准与断言规范 (Test Standards)](#3-全量可执行测试标准与断言规范)
   - 3.1 测试标准一：VSS 提权阻断断言与 CDP 内存凭据直出测试
   - 3.2 测试标准二：MCP 异步任务句柄模式超时免疫与状态机流转测试
   - 3.3 测试标准三：Git Worktree 影子工作区物理隔离与进程树硬杀测试
   - 3.4 测试标准四：客户端配置 JSONC 注释解析与异构语法分流测试
   - 3.5 测试标准五：高频遥测 CPU 开销与耗时基准比对测试
4. [脚本分类存放与测试执行治理原则](#4-脚本分类存放与测试执行治理原则)

---

## 1. 六大工程幻觉问题溯源与底层机理解构

```text
====================================================================================================
                        六大工程幻觉与真实物理限制对照矩阵
====================================================================================================

  【设计中的理想化假设 (Hallucination)】                 【真实操作系统的底层限制 (Physical Reality)】
  -----------------------------------------------      -----------------------------------------------
  1. 普通用户双击无感执行 VSS 卷影克隆                  Win32_ShadowCopy 必须具备 SeBackupPrivilege 特权；
     (reproduce_profile_capsule.ps1)                   普通权限必报 Access Denied；Chrome 127+ ABE v20 
                                                       使得拷贝走的磁盘 SQLite 文件根本无法在外部解密。

  2. 登录期间每 1.5s 注入 CDP DOM 探针                  Page Target 激活 Runtime.enable 会改变 V8 堆栈特征，
     (检测 __Secure-next-auth.session-token)           打断鼠标移动采样，Turnstile 验证码直接陷入死循环或 403。

  3. Stdio 管道挂起 60 秒等待人工输入                   官方 MCP SDK 与 Claude/Cursor 硬编码 60s 超时；
     (寸止 MCP 概念)                                   60s 到达后 IDE 强抛 -32001 错误，销毁对话上下文；
                                                       写入关闭管道引发 Node.js EPIPE 崩溃。

  4. 7 章节完整即可直接打 Patch 并单测                  Unified Diff 行号漂移导致工作区污染 (.rej 文件)；
     (无人值守 Auto-Adoption Gate)                     单测死循环时 Node 仅杀死顶层 cmd.exe，下游孤儿进程
                                                       拉满 100% CPU 并锁死文件句柄 (EBUSY 无法回滚)。

  5. 简单使用 JSON.parse 写入 mcpServers               VS Code 原生使用的是 "servers" 而非 "mcpServers"；
     (仿 Context7 setup)                               Cursor/VS Code 的 JSONC 注释直接导致 JSON.parse 崩溃；
                                                       未绑定绝对路径导致 GUI 报 spawn node ENOENT。

  6. 每秒查询 WMI Win32_Process 与短连 Tab             WmiPrvSE.exe 占用 15%~30% CPU；
     (高频实时遥测看板)                                 短连接 WebSocket 诱发 1200+ TIME_WAIT 端口耗尽。
====================================================================================================
```

---

## 2. 生产级去幻觉修复架构设计

### 2.1 凭据热克隆：CDP Browser Target 内存直出与动态回填 (Zero-Admin)
- **底层原理**：Master 种子沙盒（Port 9225）以官方 Chrome 启动，其 Network Service 进程在内存中**已持有完全解密的会话 Cookie**；
- **实现流水线**：
  1. 通过 HTTP `http://127.0.0.1:9225/json/version` 提取 Browser Target WebSocket（非 Page Target）；
  2. 发送 CDP 命令 `Storage.getCookies`，在 **10ms 内直接以 JSON 格式提取明文 Cookie**，完全不需要管理员特权、不产生任何磁盘文件锁，天然免疫 Chrome ABE (v20) 加密限制；
  3. 调度器使用用户临时目录（如 `AppData\Local\Temp\worker-9222`）拉起空白 Chrome Worker，连接其 CDP 端口执行 `Storage.setCookies` 动态灌入凭据。

### 2.2 登录流程：Browser Target 隔离监听与人工放行保底
- **彻底切断 Page Target 连接**：在用户于 9225 端口登录期间，严禁连接页面 WebSocket，严禁注入 `Runtime.evaluate` 或 DOM 探针，杜绝暴露 V8 Inspector 侧信道特征；
- **全局 Network 监听与降频**：仅通过 Browser Target 每 5 秒轻量检查一次 Cookie，或直接在 GUI 界面提供 `[ 我已登录成功，立即同步 ]` 的人工确认按钮，实现对 Turnstile 验证码的零干扰。

### 2.3 人工介入：MCP 异步任务句柄模式 (Async Task Handle Pattern)
- **彻底破除 Stdio 60 秒阻塞魔咒**：摒弃有卡死风险的 Stdio 同步挂起；
- **2 秒内即时响应机制**：
  - 当触发人工纠偏或大范围重构时，MCP `tools/call` 立即在 100ms 内返回：
    ```json
    {
      "status": "AWAITING_HUMAN_ARBITRATION",
      "task_id": "task_20260906_abc",
      "interaction_url": "http://127.0.0.1:3900/arbitration/task_20260906_abc",
      "message": "检测到架构严重偏差，已挂起当前分支。请架构师在面板完成纠偏。"
    }
    ```
  - Agent 收到该状态后，自动触发轻量轮询工具 `check_arbitration_status({ task_id })`，每次请求耗时极短，**彻底免疫 IDE 客户端 60 秒硬超时**，允许人类充分思考。

### 2.4 自动化门禁：Git Worktree 影子物理隔离与进程树硬熔断
- **物理隔离沙盒（Git Worktree）**：
  - 严禁在用户活跃目录中直接执行任何代码替换与测试；
  - 自动创建影子隔离区：
    ```bash
    git worktree add -B shadow-adoption-branch C:\GPT-Chat-codex-handoff\sandboxes\sub-worktree HEAD
    ```
  - 采用 Aider 的 `SEARCH/REPLACE` 语义块在影子沙盒中进行容错替换与编译；
  - 若测试失败，直接执行 `git worktree remove --force`，主工作区毫发无损；
- **Windows 进程树强制硬熔断**：
  - 单测执行器必须配备 Windows 专属进程树消灭机制：
    `taskkill /pid {PID} /T /F`，彻底诛杀全系子孙进程，杜绝孤儿进程拉满 CPU 与锁死文件句柄（`EBUSY`）。

### 2.5 客户端安装：JSONC 容错解析、绝对路径绑定与语法分流
- 引入 `jsonc-parser` 安全读写带有 `//` 注释的 `mcp.json`，保留用户原有排版与注释；
- 语法分流：VS Code 原生写入 `"servers"`，Cursor 与 Claude Desktop 写入 `"mcpServers"`；
- 绝对路径绑定：`command` 一律填充 `process.execPath`（如 `C:\Program Files\nodejs\node.exe`），杜绝 GUI 客户端找不到全局环境变量的 `spawn node ENOENT` 报错。

### 2.6 系统遥测：Win32 API 原生直读与 CDP 事件驱动
- 废弃 1Hz WMI 查询，改由 Tauri / Rust 侧调用 `K32GetProcessMemoryInfo` 原生 Win32 API 直读物理内存（耗时 < 5 微秒，CPU < 0.001%）；
- 废弃短连接 Tab 轮询，改向 Chrome 建立长连接并发送 `Target.setDiscoverTargets`，通过 `Target.targetCreated` / `targetDestroyed` 事件驱动更新活跃窗口数。

---

## 3. 全量可执行测试标准与断言规范

为证明上述修复不是空中楼阁，必须针对每一项重构建立自动化测试标准：

### 3.1 测试标准一：VSS 提权阻断断言与 CDP 内存凭据直出测试
* **测试目标**：
  1. 断言在普通用户权限（Medium Integrity）下调用 WMI `Win32_ShadowCopy.Create` 会直接失败抛出 Access Denied，实证 VSS 方案不可行；
  2. 验证直连 Chrome Browser Target WebSocket 发送 `Storage.getCookies` 能在 100ms 内成功提取完整明文 Cookie，实证纯内存方案可行性。
* **通过断言准则 (Pass Criteria)**：
  - 断言 A：非提权执行 WMI 卷影创建返回错误码非 0（或捕获拒绝访问异常）；
  - 断言 B：向活动 Chrome CDP 端口请求 `/json/version` 成功获取 `webSocketDebuggerUrl`；
  - 断言 C：通过 Browser Target 发送 `Storage.getCookies` 返回的数组包含有效 Cookie 对象，且整个提取耗时 $\le 200\text{ms}$。

### 3.2 测试标准二：MCP 异步任务句柄模式超时免疫与状态机流转测试
* **测试目标**：
  1. 验证在 Stdio JSON-RPC 模式下，工具调用不再阻塞长达 60s，而是在 500ms 内立返任务句柄；
  2. 验证状态机管理类能够正确记录会话状态，并在人工提交后通过短轮询立即被 Agent 消费。
* **通过断言准则 (Pass Criteria)**：
  - 断言 A：发起 `awaitHumanOrTimeout` 挂起时，单次 RPC 响应耗时 $\le 100\text{ms}$；
  - 断言 B：外部模拟调用 `submitHumanFeedback(taskId, notes)` 能够在状态表中正确流转为 `RESOLVED`；
  - 断言 C：随后的 `check_arbitration_status` 成功消费该纠偏批注，且未触发任何 Stdio EPIPE 或未捕获异常。

### 3.3 测试标准三：Git Worktree 影子工作区物理隔离与进程树硬杀测试
* **测试目标**：
  1. 验证通过 `git worktree add` 派生独立影子分支并在其中引入故障代码，主工作区 Git 状态保持 100% 洁净；
  2. 验证在影子目录中启动故意陷入 `while(true)` 死循环的测试脚本时，超时看门狗能够通过 `taskkill /T /F` 在 3 秒内彻底消灭全部子孙进程，释放所有文件锁。
* **通过断言准则 (Pass Criteria)**：
  - 断言 A：影子分支创建成功，向影子分支写入脏数据后，主工作区 `git status --porcelain` 恒为空；
  - 断言 B：故意启动的死循环进程树在 3000ms 超时到达时被成功终止，退出码非 0；
  - 断言 C：执行 `tasklist` 确认死循环的下游 node 进程已被完全清除（无孤儿进程残留）；
  - 断言 D：执行 `git worktree remove --force` 成功移除影子目录，无 `EBUSY` 文件占用报错。

### 3.4 测试标准四：客户端配置 JSONC 注释解析与异构语法分流测试
* **测试目标**：
  1. 验证测试解析包含 `// 行注释` 与 `/* 块注释 */` 的典型 Cursor / VS Code 配置文件，断言使用原生 `JSON.parse` 报错，而容错解析器 100% 成功提取；
  2. 验证生成配置时，VS Code 被准确分流为 `"servers"` 根键，Cursor / Claude 被准确分流为 `"mcpServers"`，且 `command` 字段填充绝对路径。
* **通过断言准则 (Pass Criteria)**：
  - 断言 A：带注释的 JSONC 文本成功解析为 JS 对象，注释被妥善剥离或保留；
  - 断言 B：生成的 VS Code 配置对象拥有 `servers` 属性，无 `mcpServers`；
  - 断言 C：生成的 Cursor 配置对象拥有 `mcpServers` 属性；
  - 断言 D：`command` 字段以操作系统的可执行文件绝对路径开头（匹配 `node.exe` 真实路径）。

### 3.5 测试标准五：高频遥测 CPU 开销与耗时基准比对测试
* **测试目标**：
  1. 对比执行 10 次 WMI `Get-CimInstance Win32_Process` 查询与执行 10 次原生进程句柄直查的耗时与 CPU 消耗；
  2. 证明高频查询必须从 WMI 剥离。
* **通过断言准则 (Pass Criteria)**：
  - 断言 A：原生 Win32 / 进程直查单次耗时 $\le 10\text{ms}$；
  - 断言 B：WMI 单次遍历耗时明显大于原生直查（通常相差 10~50 倍）；
  - 断言 C：输出准确的耗时倍数与架构优化建议。

---

## 4. 脚本分类存放与测试执行治理原则

根据工作区核心治理铁律（`C:\code\Chat-Codex\AGENTS.md`）：
1. **统一收敛于集成主干**：所有新增的可行性测试脚本一律存放在：
   `C:\code\Chat-Codex\handoff-core\tests\feasibility\`
   严禁向根目录散落任何新的临时文件；
2. **测试结果物理落盘归档**：每个专项测试执行完毕后，测试结果一律落盘至：
   `C:\code\Chat-Codex\docs\工程幻觉偏移分析修复\` 目录下，并以对应测试名称命名（如 `test_01_vss_vs_cdp_cookies_result.md` 等）；
3. **主线文档锁定**：在所有测试脚本自动化执行完毕、生成实测报告、并经由用户审核批准前，严禁擅自修改主线已批准的 `design.md`。
