# GPT-Chat-Codex-Handoff 目标系统架构设计规范 (Windows 统一路径版)

本文档为系统的核心设计规范文件，明确了在 **Windows 纯原生环境** 下的路径收敛方案，彻底消除 Unix 遗留的 `~` 或 macOS 风格路径冲突，将**浏览器沙盒、进程锁、状态缓存、以及三级任务产物归档**全量收敛至指定的 `C:\GPT-Chat-codex-handoff\` 目录。

---

## 1. 冲突复盘与 Windows 统一路径原则

### 1.1 为什么废除 `~` 与 `%USERPROFILE%` 离散路径
* **冲突点**：在 Windows 系统中使用类 Unix 的 `~` 符号，系统会隐式将其解析到 `C:\Users\<用户名>\.chatgpt-pro\`。这导致：
  1. 浏览器 Profile、缓存与锁分散在用户个人家目录下，与指定的业务目录 `C:\GPT-Chat-codex-handoff\` 脱节；
  2. 造成项目文件分散、备份清理困难、污染系统用户目录；
  3. 违反了 Windows 软件“单一目录自包含（Self-contained Workspace）”的最佳工程实践。
* **统一原则**：
  - **单一根目录收敛**：所有的运行状态、Chrome 调试沙盒、进程锁、以及沉淀的任务 Markdown 统一收纳于 `C:\GPT-Chat-codex-handoff\`；
  - **原生 Windows 命名规范**：全面采用标准盘符绝对路径（`C:\...`）及 Windows 反斜杠（`\`）；
  - **动静隔离**：动态运行态（`.runtime\`）与业务归档产物（项目大分类）在同一根目录下逻辑隔离。

---

## 2. 目标文件存储全景拓扑 (Unified Windows Storage Hierarchy)

```text
====================================================================================================
               C:\GPT-Chat-codex-handoff\ 统一 Windows 存储与运行拓扑
====================================================================================================

C:\ (系统盘根目录)
└── GPT-Chat-codex-handoff\                                    <-- 统一根目录 (Self-contained)
    │
    ├── .runtime\                                              <-- [系统运行时基础设施，完全收敛在内部]
    │   ├── chrome-profile\                                    <-- 独立正版 Chrome 数据沙盒 (避免写入C:\Users)
    │   │   ├── Default\ (Cookies, Local Storage, Cache, TLS Session)
    │   │   └── First Run / Preferences
    │   ├── locks\                                             <-- 进程排他锁目录
    │   │   └── browser.lock                                   <-- 跨进程文件锁 (防止多任务争抢页面)
    │   └── state\                                             <-- 状态与模型缓存
    │       ├── chrome-session.json                            <-- 当前 Chrome PID、CDP 端口及 WebSocket URL
    │       └── model-state-cache.json                         <-- 捕获到的模型版本与思考级别
    │
    ├── codex-chatgpt-pro-plugin\                              <-- [项目大分类 1: pauljunsukhan CDP方案]
    │   │
    │   ├── 2026-09-04\                                        <-- [日期小分类 YYYY-MM-DD]
    │   │   ├── 01-cdp-native-chrome-architecture.md           <-- [任务编号]-[搜索概要任务名].md
    │   │   ├── 02-anti-detection-vs-playwright.md
    │   │   └── 03-windows-deployment-and-wmi-avoidance.md
    │   │
    │   └── 2026-09-05\                                        <-- 后续日期小分类
    │       └── 01-multi-agent-lock-stress-test.md
    │
    ├── codex-bridge-chatgpt\                                  <-- [项目大分类 2: anightmonarch 契约方案]
    │   │
    │   └── 2026-09-04\
    │       ├── 01-context-packet-contract-and-validator.md
    │       ├── 02-in-app-browser-and-cli-limitations.md
    │       └── 03-local-adoption-gate-security.md
    │
    └── hybrid-architecture\                                   <-- [项目大分类 3: 双脑融合方案]
        │
        └── 2026-09-04\
            └── 01-dual-brain-cdp-contract-fusion.md
```

### 路径绝对映射清单 (Windows Path Specifications)

| 逻辑角色 | 规范化绝对路径 (Windows 格式) | 作用说明 |
| :--- | :--- | :--- |
| **系统总根目录** | `C:\GPT-Chat-codex-handoff\` | 所有产物与运行时的唯一宿主根目录 |
| **Chrome 沙盒目录** | `C:\GPT-Chat-codex-handoff\.runtime\chrome-profile\` | 代替 `~/.chatgpt-pro`，保存 ChatGPT 独立真实登录态 |
| **进程排他锁** | `C:\GPT-Chat-codex-handoff\.runtime\locks\browser.lock`| 纯文件锁，杜绝并发调用冲突 |
| **会话状态文件** | `C:\GPT-Chat-codex-handoff\.runtime\state\chrome-session.json` | 记录活动的 WebSocket 调试端点与进程信息 |
| **任务归档路径** | `C:\GPT-Chat-codex-handoff\{项目大分类}\{YYYY-MM-DD}\{任务名}.md` | 统一产物持久化路由 |

---

## 3. 目标系统架构全景 (System Architecture)

```text
====================================================================================================
                        GPT-Chat-Codex-Handoff 目标系统架构全景 (Windows 优化版)
====================================================================================================

      ┌────────────────────────────────────────────────────────────────────────┐
      │               本地工作区 (VS Code 终端 / Codex 本地执行环境)             │
      │                                                                        │
      │   1. 本地代码快速取证 (只提取影响决策的核心代码与报错，避免冗余)            │
      │   2. 组装 1~3K Context Packet 契约包 (带 packet_id 与 6 大固定章节)       │
      │   3. 运行本地敏感凭据扫描与格式校验 (拦截明文私钥、AKIA、Token 等)         │
      └───────────────────────────────────┬────────────────────────────────────┘
                                          │ 
                                          │ 触发物理输入指令 (JSON-RPC)
                                          ▼
      ┌────────────────────────────────────────────────────────────────────────┐
      │          底层通信与防风控引擎 (基于 pauljunsukhan 原生 CDP 直连)          │
      │                                                                        │
      │   • 载体: 宿主机官方正版 Chrome (C:\Program Files\Google\Chrome\...)     │
      │   • 端口: WebSocket 直连 127.0.0.1:9222 (零框架常驻, 零 WMI 监控死循环) │
      │   • 启动参数: 严格剥离 --enable-automation (navigator.webdriver 保持正常) │
      │   • 统一沙盒: C:\GPT-Chat-codex-handoff\.runtime\chrome-profile\       │
      │   • 统一锁控: C:\GPT-Chat-codex-handoff\.runtime\locks\browser.lock    │
      │   • 物理事件派发: CDP Input.insertText / dispatchMouseEvent (isTrusted)│
      └───────────────────────────────────┬────────────────────────────────────┘
                                          │ 物理级键盘注入 Prompt
                                          ▼
      ┌────────────────────────────────────────────────────────────────────────┐
      │              网页端思考体 (ChatGPT Pro / o1 / o3 / Web Search)         │
      │                                                                        │
      │   • 接收由 Context Packet 包装的 1~3K 精简上下文                       │
      │   • 激活网页端特权能力: 深度思考模式 (Reasoning) / 实时联网搜索 (Search)│
      │   • 强约束输出契约: 强制按 BEGIN_REASONING_RESULT 7 大章节结构化输出   │
      └───────────────────────────────────┬────────────────────────────────────┘
                                          │ 生成完毕 (Stop 图标消失，Copy 按钮点亮)
                                          ▼
      ┌────────────────────────────────────────────────────────────────────────┐
      │              结果捕获与本地采纳门禁 (Local Adoption Gate)               │
      │                                                                        │
      │   • 数据拉取: 自动化触发官方 Copy 按钮从系统剪贴板获取 (严禁抓取残缺DOM)│
      │   • 契约校验: 校验 packet_id 匹配度与 7 大段落完整性                    │
      │   • 安全屏障: 网页输出一律标记为 Untrusted Data, 严禁直接管道执行      │
      │   • 本地核验: 重新检索本地真实符号与文件，标记 accepted / rejected     │
      │   • 本地修改: 由本地 Agent 自主重构补丁，并在本地运行单元测试验证        │
      └───────────────────────────────────┬────────────────────────────────────┘
                                          │
                                          │ 自动格式化输出并沉淀归档
                                          ▼
      ┌────────────────────────────────────────────────────────────────────────┐
      │                       自动目标归档沉淀引擎                             │
      │                                                                        │
      │   绝对归档路由:                                                        │
      │   C:\GPT-Chat-codex-handoff\{Project}\{YYYY-MM-DD}\{TaskName}.md       │
      │                                                                        │
      │   产物包含: 任务目标、决定性证据、网页端深度思考推理、本地采纳状态、测试回执│
      └────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Windows 环境下的落地配置规范 (Runtime Configuration)

为了确保执行脚本时严格落实上述路径，统一在 Windows PowerShell 环境中采用以下启动与传参规范：

### 4.1 环境变量覆盖规范
在执行前通过环境变量重定向沙盒与根目录，禁止回退到系统家目录：
```powershell
# 指定 Chrome 调试沙盒完全存放在 C 盘目标目录下
$env:CHROME_USER_DATA_DIR = "C:\GPT-Chat-codex-handoff\.runtime\chrome-profile"

# 指定状态与锁的主目录
$env:CHATGPT_PRO_HOME = "C:\GPT-Chat-codex-handoff\.runtime"

# 指定正版 Chrome 真实安装路径
$env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

### 4.2 Chrome 原生启动命令（纯 Windows 格式）
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
    --remote-debugging-address=127.0.0.1 `
    --remote-debugging-port=9222 `
    --user-data-dir="C:\GPT-Chat-codex-handoff\.runtime\chrome-profile" `
    --no-first-run `
    --no-default-browser-check `
    --disable-default-apps `
    --disable-popup-blocking `
    --window-size="1320,920" `
    "https://chatgpt.com"
```

### 4.3 自动化任务归档写入规约
在每次执行完毕后，归档脚本通过标准 Node.js / PowerShell 逻辑，根据当前执行的项目名及系统日期自动生成目录并写入：
```powershell
$targetDir = "C:\GPT-Chat-codex-handoff\$projectName\$(Get-Date -Format 'yyyy-MM-dd')"
if (-not (Test-Path $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force }
# 输出写入: $targetDir\$taskNumber-$taskSummary.md
```
所有过程完全封口在 `C:\GPT-Chat-codex-handoff\` 之内，实现系统纯净、独立、免污染、免 WMI 高 CPU 占用的全链路闭环。
