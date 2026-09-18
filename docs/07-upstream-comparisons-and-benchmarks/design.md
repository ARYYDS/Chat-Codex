# 模块七：上游方案解构、实机基准测试与验收矩阵 (Upstream & Benchmarks)

本文档是 Chat-Codex 系统的上游开源方案对比解构、实机性能压测基准（Benchmarks）与生产级故障注入验收矩阵规范。

---

## 1. 上游方案能力解构与设计精髓借鉴

系统深度解构并融合了相邻两大独立上游方案（`codex-bridge-chatgpt` 与 `codex-chatgpt-pro-plugin`）的核心设计精髓，在**顶层协议契约治理**与**底层工业级自动化驱动**两个关键维度实现了深度互补：

```text
====================================================================================================
                        两项目核心定位与互补特性对照
====================================================================================================

      codex-bridge-chatgpt (anightmonarch)                codex-chatgpt-pro-plugin (pauljunsukhan)
  ┌──────────────────────────────────────────┐          ┌──────────────────────────────────────────┐
  │         【顶层协议与契约安全治理】          │          │          【底层工业级自动化与驱动】         │
  │                                          │          │                                          │
  │ • 零信任安全原则 (Untrusted Web Output)  │          │ • 原生免驱 CDP 直连 (无 Puppeteer 特征)  │
  │ • 严格的 Context Packet 契约 (1~3K Tokens) │   拼接   │ • 跨进程排他锁与心跳机制 (browser.lock)   │
  │ • 7 大结构化章节输出 (Reasoning Result)   │ ───────► │ • 仓库级房间会话管理 (Repo-scoped Rooms) │
  │ • 强制本地采纳门禁 (Local Adoption Gate)  │          │ • 仓库单文件打包与附件上传 (Repomix+CDP)  │
  │ • SHA-256 审计回执与数据不可篡改链       │          │ • 页面富文本合成事件与状态机智能观测     │
  └──────────────────────────────────────────┘          └──────────────────────────────────────────┘
```

---

## 2. 核心机制实机基准测试对比 (Benchmarks)

通过在真实 Windows 操作系统环境下的对比压测，确立了系统的五大核心实测基准：

| 性能指标 / 场景 | 旧版方案 / 传统机制 | 现代主干方案 (Mainline Verified) | 实测性能提升与效果 |
|---|---|---|---|
| **会话凭据同步** | VSS 卷影快照（耗时 2500~3800ms，需管理员特权） | **CDP Browser Target 纯内存导出与回填** | **耗时仅 105ms (提速 30 倍)**，普通权限 100% 成功 |
| **高频遥测监控** | PowerShell WMI `Win32_Process` 轮询（耗时 824ms） | **Win32 `K32GetProcessMemoryInfo` 原生调用** | **平均 3.54µs (提速 232,795 倍)**，CPU 占用趋于 0% |
| **MCP 长任务调度** | Stdio 挂起 60 秒（触发 IDE 客户端超时崩溃） | **异步任务句柄模式 (`lib/mcp-async-handle.js`)** | **0.11ms 极速交付**，彻底解耦长程推理时间 |
| **代码补丁门禁** | 直接覆盖本地工作区，失败则 `git reset --hard` | **Git Worktree 影子工作树沙盒隔离** | **主工作区 0 污染**，完全消除未提交代码丢失风险 |
| **配置文件解析** | 原生 `JSON.parse`（遇到 `//` 注释 100% 抛错） | **微软标准 `jsonc-parser` + 客户端语法分流** | **100% 容错解析注释**，自动适配 VS Code / Cursor |

---

## 3. 全量自动化测试套件回归总览 (24/24 Passed)

系统建立了由 **纯离线确定性单元测试 (`tests/offline/`)**、**工程可行性验证测试 (`tests/feasibility/`)** 与 **全流程 MVP 实机测试 (`tests/mvp_full_flow.test.js`)** 构成的完整回归体系：

```text
====================================================================================================
                        全量自动化测试回归报告 (2026 Edition)
====================================================================================================

[可行性审计测试集]
✔ Test 01.1: Verify WMI Win32_ShadowCopy fails in non-elevated user context (2565ms)
✔ Test 01.2: Verify CDP Browser Target dumps memory cookies in < 200ms with ZERO admin rights (128ms)
✔ Test 02: Verify MCP Async Handle pattern responds in < 100ms and avoids 60s timeout deadlocks (5ms)
✔ Test 03.1: Verify Git Worktree creates an isolated shadow sandbox without dirtying main workspace (800ms)
✔ Test 03.2: Verify Windows taskkill /T /F terminates runaway test processes and child process trees (1895ms)
✔ Test 04.1: Verify JSONC with comments crashes native JSON.parse but passes safe parser (4ms)
✔ Test 04.2: Verify client-specific configuration syntax dispatch and absolute node path (0.7ms)
✔ Test 05: Benchmark high-frequency WMI process query vs Native process telemetry (3754ms)

[全流程 MVP 实机测试集]
✔ MVP Step 1 & 2: Master 9225 memory dump and Worker 9222 dynamic cookie injection (285ms)
✔ MVP Step 3: Ephemeral Tab lifecycle and renderer memory reclamation on Worker 9222 (2562ms)
✔ MVP Step 4: MCP Async Task Handle non-blocking lifecycle (<1ms response & human arbitration) (4ms)
✔ MVP Step 5: Git Worktree Shadow Sandbox Local Adoption Gate (1005ms)

[离线单元测试集]
✔ mcp cli --help returns usage and registers all tools (340ms)
✔ mcp stdio json-rpc tools/list returns exactly 5 tools with valid schemas (381ms)
✔ mcp stdio json-rpc resources/list returns 3 registered resources (1117ms)
✔ mcp tool chatgpt_adoption_verify validates 7-section structure and diffs (680ms)
✔ mcp tool chatgpt_upload_context creates monofile context offline (312ms)
✔ mcp tool chatgpt_reason asyncHandle returns instant handle avoiding timeout (716ms)
✔ handoff setup command detects installed editors and runs dry-run install (315ms)
✔ project identity and archive root survive cwd changes and workspace aliases (1434ms)
✔ archive conflicts preserve original bytes; repeat imports are idempotent (1651ms)
✔ help paths do not contact browsers or run implicit tasks (810ms)
✔ cloner dry run selects configured runtime data without launching (1476ms)
✔ synthetic SQLite WAL recovery remains valid after moving test source (212ms)

----------------------------------------------------------------------------------------------------
ℹ tests: 24 | suites: 0 | pass: 24 (100%) | fail: 0 | cancelled: 0 | skipped: 0 | todo: 0
====================================================================================================
```

---

## 4. 生产级故障注入验收矩阵 (Fault-Injection Matrix)

系统在正式投入生产环境前，必须通过以下 14 项严格的故障注入断言：

| 故障注入场景 | 预期系统自愈行为 | 判定失败的违背标准 |
|---|---|---|
| **关闭终端 / 重启 IDE** | Keeper 与 Chrome 实例保持运行；新客户端可通过任务 ID 重新 attach | Chrome 随终端级联退出 |
| **杀死任务协调器 (Broker)** | Keeper 与 Chrome 实例保持；Broker 重启后从磁盘日志恢复任务状态 | 重新执行已确认的写操作 |
| **杀死常驻宿主 (Keeper)** | 按预设策略重新拉起 Keeper 并通过 Target 重新接管 Chrome | 产生无人管理的僵尸孤儿实例 |
| **Chrome 意外崩溃** | `browserEpoch` 递增，重建资源并向 Broker 报告实例重置 | 继续向已失效的对象句柄发送指令 |
| **写操作时响应丢失** | 标记为 `UNKNOWN`，重连后先查询会话树核对业务效果 | 自动再次点击造成重复提交 |
| **S3 睡眠 / Modern Standby** | 唤醒后进入恢复宽限期，三层探针依次核验 | 将睡眠时间计入连续超时并误杀实例 |
| **VPN 切换或网络断流** | 分别判定本地 CDP 通道与远端 HTTP 流，不误动本地浏览器 | 每次网络重置均重启 Chrome |
| **大附件与长截图事件** | 启用有界容量限制队列，超出限制降级采样 | 内存无限制暴涨或阻塞心跳 |
| **管道首实例被占用** | 拒绝启动并记录冲突，严禁盲目连接未知管道 | 越权连接不受控的管道服务 |
| **新旧 MCP 客户端混合** | 根据协议协商自动分流（旧版普通 Tool，新版 Tasks 扩展） | 向旧客户端发送未协商的格式 |
| **配置文件并发只写入一半** | 保持上一份经过验证的内存配置，报告解析错误 | 使用破损残缺的配置对象 |
| **代码执行 Worker 死循环** | 看门狗通过进程树硬杀清理专属 Worker Job | 误杀 Keeper 宿主或主 Chrome |
| **Git 主分支在验证期变更** | 影子门禁拒绝基于旧基线的直接提交，要求重基线验证 | 静默覆盖主分支上的并发提交 |
| **RDP 桌面与 GPU 环境切换** | 重新校验图形设备上下文与页面渲染水合状态 | 持续使用已失效的坐标或渲染黑屏 |
