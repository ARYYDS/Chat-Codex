# GPT-Chat-Codex 浏览器子母架构与系统设计生产级规范 (v2.5.0-Verified)

本文档为 Chat-Codex 桌面系统的**权威顶层架构蓝图与设计总纲**。系统确立了在 **Windows 纯原生环境** 下构建 **“浏览器子母版架构（Master-Worker Architecture）”** 与 **“Keeper-Broker 解耦协同体系”** 的工业级标准。

通过解耦凭据母本与工作沙箱、结合 CDP Browser Target 纯内存凭据热同步、Win32 Job Object 原子作业隔离、Git Worktree 影子工作树门禁、以及 Ephemeral Tab 动态随机错峰调度，实现单机极低内存消耗（~84MB 级基线）下稳定承载 10 路以上深度检索并发，彻底解决 Cloudflare Turnstile、OpenAI Sentinel（动态 PoW / JA4 指纹）、Windows Chrome 凭据加密（App-Bound v20）及行为风控限流等工业级难题。

---

## 目录
- [架构专题子模块导航索引](#架构专题子模块导航索引)
- [1. 系统全域多层架构拓扑](#1-系统全域多层架构拓扑)
- [2. 五大工程幻觉去幻与实机断言成果](#2-五大工程幻觉去幻与实机断言成果)
- [3. 双层子母与 Keeper-Broker 解耦协同模型](#3-双层子母与-keeper-broker-解耦协同模型)
- [4. Windows 凭据安全与零特权内存同步规范](#4-windows-凭据安全与零特权内存同步规范)
- [5. 高并发动态 Jitter 调度与反风控机制](#5-高并发动态-jitter-调度与反风控机制)
- [6. Windows 进程生命周期、Job Object 与命名管道](#6-windows-进程生命周期job-object-与命名管道)
- [7. 统一运行态存储拓扑与三级研报知识图谱](#7-统一运行态存储拓扑与三级研报知识图谱)
- [8. 自动化 MCP 服务层与零信任代码采纳门禁](#8-自动化-mcp-服务层与零信任代码采纳门禁)
- [9. 实机基准测试压测与故障注入验收矩阵](#9-实机基准测试压测与故障注入验收矩阵)
- [10. 核心运行参数与 CLI 运维指令速查](#10-核心运行参数与-cli-运维指令速查)

---

## 架构专题子模块导航索引

为遵循单一职责原则并提升架构可维护性，系统核心规范已拆分为以下 7 大专业子模块：

| 序号 | 专题设计模块 | 核心技术要点与工程规范 | 详细规范文件 |
| :---: | :--- | :--- | :---: |
| **01** | **核心架构演进与双层子母模型** | L0 母本基座、L1 物理实例、L2 瞬态页签；Keeper-Broker 解耦与六大系统不变量矩阵 | [01-architecture-overview/design.md](file:///C:/code/Chat-Codex/docs/01-architecture-overview/design.md) |
| **02** | **Windows 凭据安全与内存同步** | 淘汰 VSS 提权；Chrome 127+ ~ 152+ App-Bound 与 DPAPI 边界；CDP Browser Target 105ms 零特权纯内存同步 | [02-security-and-credentials/design.md](file:///C:/code/Chat-Codex/docs/02-security-and-credentials/design.md) |
| **03** | **高并发错峰调度与反风控机制** | 动态随机抖动错峰调度算法；ProseMirror 事件合成；未决操作分类状态机；Daybreak 学术化降敏自愈 | [03-dispatch-and-anti-risk/design.md](file:///C:/code/Chat-Codex/docs/03-dispatch-and-anti-risk/design.md) |
| **04** | **Windows 进程、Job 与桌面穿透** | `PROC_THREAD_ATTRIBUTE_JOB_LIST` 原子绑定作业对象；Named Pipe EOF 退出分析；Session 0 穿透；进程树硬杀 | [04-windows-process-and-desktop/design.md](file:///C:/code/Chat-Codex/docs/04-windows-process-and-desktop/design.md) |
| **05** | **统一运行时存储与三级研报图谱** | `C:\GPT-Chat-codex-handoff\` 统一收敛；PassSearchHistory 4h 时间桶归档；GraphRAG 知识图谱自动编排 | [05-storage-and-archive-topology/design.md](file:///C:/code/Chat-Codex/docs/05-storage-and-archive-topology/design.md) |
| **06** | **自动化 MCP 与零信任采纳门禁** | MCP 2026-07-28 Tasks 规范演进；异步任务句柄模式彻底破解 60s 硬超时；Git Worktree 影子沙盒本地门禁 | [06-mcp-protocol-and-adoption-gate/design.md](file:///C:/code/Chat-Codex/docs/06-mcp-protocol-and-adoption-gate/design.md) |
| **07** | **上游解构、基准测试与验收矩阵** | codex-bridge 与 pro-plugin 借鉴；23 万倍遥测性能压测；24/24 项全量测试回归；14 大故障注入验收矩阵 | [07-upstream-comparisons-and-benchmarks/design.md](file:///C:/code/Chat-Codex/docs/07-upstream-comparisons-and-benchmarks/design.md) |

---

## 1. 系统全域多层架构拓扑

```text
====================================================================================================
               Chat-Codex 系统全域多层架构拓扑 (双脑协同 + MCP 自动化手递手管线)
====================================================================================================

      +------------------------------------------------------------------------+
      |               本地工作区 (VS Code / Cursor / Antigravity 本地执行环境)      |
      |                                                                        |
      |   1. 提取关键符号、局部报错、Git 变更树                                  |
      |   2. 组装契约包 (Context Packet): 1~3K Tokens，6大固定段落，敏感凭据脱敏 |
      |   3. 确立本地决策主权: ChatGPT 仅作为推理顾问，执行权与决策权锁定在本地   |
      +-----------------------------------+------------------------------------+
                                          | JSON-RPC 2.0 / CLI 异步任务调用
                                          v
      +------------------------------------------------------------------------+
      |              任务协调中枢 (Broker: handoff-core Integration Engine)     |
      |                                                                        |
      |   * 协议标准: Stdio JSON-RPC 2.0 规范                                  |
      |   * 5 大核心 Tools: chatgpt_reason, upload_context, session, doctor, verify |
      |   * 防超时机制: 异步任务句柄模式 (Async Task Handle, < 1ms 即时交付)      |
      |   * 跨进程排他锁: browser.lock 互斥锁控                                  |
      +-----------------------------------+------------------------------------+
                                          | 租约校验与命令路由 (ownerEpoch)
                                          v
      +------------------------------------------------------------------------+
      |              常驻浏览器宿主 (Keeper: Resident Browser Host)             |
      |                                                                        |
      |   * 进程隔离: 使用 PROC_THREAD_ATTRIBUTE_JOB_LIST 绑定独立 browserJob    |
      |   * 职责: 极简稳定，持有浏览器进程句柄与 Job 句柄，负责 CDP 路由与权限检查 |
      +-----------------------------------+------------------------------------+
                                          | 原生 CDP (Chrome DevTools Protocol)
                                          v
      +------------------------------------------------------------------------+
      |          Chrome 双层沙盒架构 (Dual-Tier CDP Isolation Architecture)     |
      |                                                                        |
      |   [L0 Master-Seed 种子沙盒: Port 9225] -> 人工登录保鲜，纯内存凭据源    |
      |   [L1 Worker 运行时沙盒: Port 9222/9223] -> sub-instance-1 / 2         |
      |   [L2 瞬态页签: Ephemeral Tabs] -> PUT /json/new，完成即关回收显存进程    |
      +-----------------------------------+------------------------------------+
                                          | 注入 Prompt / 触发深度思考
                                          v
      +------------------------------------------------------------------------+
      |              网页端思考体 (ChatGPT Pro / o1 / o3 / Web Search)         |
      |                                                                        |
      |   * 深度推理与全网实时检索                                              |
      |   * 严格输出契约: BEGIN_REASONING_RESULT (7大结构化章节)                |
      |   * 绑定校验: 回传匹配的 packet_id                                     |
      +-----------------------------------+------------------------------------+
                                          | 监听 Stop 按钮消失，自动化提取响应文本
                                          v
      +------------------------------------------------------------------------+
      |              结果捕获与本地采纳门禁 (Local Adoption Gate)               |
      |                                                                        |
      |   * 零信任隔离: 网页返回一律标记为 Untrusted Data，严禁主工作区管道执行 |
      |   * 影子沙盒: 动态挂载 artifacts/sandboxes/shadow-{id} 独立 Worktree   |
      |   * 进程树硬杀守卫: 看门狗通过 taskkill /T /F 彻底杜绝测试进程锁死句柄   |
      +-----------------------------------+------------------------------------+
                                          | 生成 SHA-256 收据并持久化
                                          v
      +------------------------------------------------------------------------+
      |               统一存储与归档中心 (C:\GPT-Chat-codex-handoff\)          |
      |                                                                        |
      |   * 结构化历史归档: PassSearchHistory\{Project}\{YYYY-MM-DD}\{4h桶}\*.md|
      |   * 自动知识图谱: codegraph.json (GraphRAG 实体与时序关系)              |
      |   * 全局总索引: PassSearchHistory\README.md                             |
      +------------------------------------------------------------------------+
```

---

## 2. 五大工程幻觉去幻与实机断言成果

在经过严格的 24 项实机自动化回归与工程审查后，系统完成了对传统设计中“五大工程幻觉”的彻底去幻：

| 审查维度 | 原有设计缺陷 (工程幻觉) | 实机真实断言 | 现代落地生产方案 (Mainline Verified) |
|---|---|---|---|
| **1. 凭据提取与克隆** | 假设普通用户可无感执行 VSS 卷影快照克隆 | 非提权下 WMI 直接报 `Access Denied (9)` | **CDP Browser Target 纯内存直出**（105ms 完成导出与注入，0 提权依赖） |
| **2. 寸止 MCP / 人工仲裁** | 假设在 Stdio 管道中挂起 60 秒等待人类输入 | IDE 客户端硬编码 60s 超时抛错 `-32001` 并破坏会话 | **异步任务句柄模式 (Async Task Handle)**（0.11ms 极速交付，短轮询解耦长程推理） |
| **3. 代码自动化采纳门禁** | 假设在本地工作区打补丁，失败则 `git reset --hard` | 格式偏移留下 `.rej` 碎片，`reset` 永久抹杀用户未暂存代码 | **Git Worktree 影子工作树沙盒隔离**（独立目录编译与单测，主工作区 0 污染） |
| **4. 一键安装器** | 假设所有 IDE 使用标准 JSON 且配置键名一致 | 配置含 `//` 注释致 `JSON.parse` 100% 崩溃；VS Code 与 Cursor 键名分裂 | **JSONC 容错解析 + 异构语法分流**（安全解析注释，自动识别 `"servers"` 与 `"mcpServers"`） |
| **5. 1Hz 高频遥测监控** | 每秒执行 PowerShell `Get-CimInstance Win32_Process` | 单次遍历耗时 824ms，单核 CPU 占满，系统 WMI 暴涨至 30% | **Win32 `K32GetProcessMemoryInfo` 原生调用**（单次仅 3.54µs，提速 232,795 倍，0% CPU） |

---

## 3. 双层子母与 Keeper-Broker 解耦协同模型

### 3.1 物理实例 (L1) 与瞬态页签 (L2) 解耦
- **Level 0: 凭据母本基座 (Master Seed Profile, Port 9225)**：`C:\GPT-Chat-codex-handoff\master-seed-profile\`。唯一的免受自动化污染的人工登录基座。严禁任何自动化脚本直接以该 Profile 启动自动化测试或注入 Prompt；
- **Level 1: 物理工作实例解耦 (Worker Instances, Port 9222/9223)**：`C:\code\Chat-Codex\sub-instance-1\`（Port 9222）、`sub-instance-2\`（Port 9223）。视为“可复位的无状态易耗品”，启动时通过内存注入 Session Token；
- **Level 2: 会话页签子母解耦 (Ephemeral Tab Workers)**：Worker 内部不采用单会话串行模式，而是通过 CDP HTTP 原语 `PUT /json/new?https://chatgpt.com/` 动态开辟全新隔离 Tab。任务收敛后在 1 秒内调用 `/json/close/{targetId}` 显式销毁页签，物理释放 Blink Renderer 进程与显存，单实例常态驻留内存压降至 **~84MB**。

### 3.2 2026 前沿架构升级：Keeper - Broker 模式与不变量矩阵
针对长程推理过程中 IDE 重启、网络抖动导致的链路脆弱性，系统引入了业界最新的 **Keeper - Broker 双进程拓扑**，明确了六大系统不变量：

| 系统不变量 (Invariant) | 核心工程含义与防御机制 |
|---|---|
| **1. IDE 退出 $\neq$ 任务取消** | IDE 仅持有客户端通信连接，不持有决定 Chrome 存亡的最后一个 Job 或管道句柄；IDE 重启后通过任务 ID 重新 attach 既有任务。 |
| **2. Broker 重启 $\neq$ 浏览器重启** | 常驻宿主 Keeper 持有浏览器句柄与 CDP 连接；Broker 崩溃重启后自动重新连接 Keeper，不影响正在流式生成的 Web 页面。 |
| **3. 连接断开 $\neq$ 操作未执行** | CDP 连接异常断开时，正在发送的操作进入 `UNKNOWN` 状态；重连后先核对远端会话树，禁止直接盲目重放造成二次点击。 |
| **4. Handoff 唯一写入者原则** | 同一浏览器资源在任何时刻只能有唯一写入者；通过递增的 `ownerEpoch` 租约进行门禁断言，旧端的在途指令直接失效。 |
| **5. Worker 故障不波及宿主** | 单个代码执行 Worker 运行在专属的 Worker Job 中，超时或死循环触发硬杀时，不波及 Browser Job 与 Keeper。 |
| **6. 进程存活 $\neq$ 任务仍在推进** | 建立传输层（Ping/Pong）、浏览器层（Browser.getVersion）与任务层（DOM 增量与流式状态）三级独立监控，分别识别僵死。 |

### 3.3 四类生命周期标识的分离
在系统内部，严格区分以下四类生命周期范围，杜绝混淆：
1. **`taskId`（业务任务域）**：唯一标识一次用户端发起的长程推理或调试任务，任务结束前保持不可变；
2. **`browserEpoch`（浏览器实例域）**：标识一次 Chrome 物理进程的生命周期，Chrome 进程重启时递增；
3. **`connectionEpoch`（传输通道域）**：标识一次 CDP 连接的建立，WebSocket 重连或端口重新发现时递增；
4. **`ownerEpoch`（写入权限租约域）**：标识当前控制权的授予代次，双脑 Handoff 或人工介入接管时严格递增。

---

## 4. Windows 凭据安全与零特权内存同步规范

### 4.1 Chrome App-Bound Encryption (v20) 与独立目录 DPAPI 机制
- Chrome 127+ 在默认数据目录（`%LOCALAPPDATA%\Google\Chrome\User Data`）引入 **App-Bound Encryption (ABE v20)**，密钥由 `elevation_service.exe` 绑定至可执行文件签名与路径，外部脚本无法解密；
- 当启动 Chrome 显式传入独立的 `--user-data-dir`（脱离默认目录）时，Chromium 安全机制自动回退到 **Windows DPAPI (`v10` 保护)**，同 Windows 用户权限的脚本可合法存取。

### 4.2 Chrome 136+ (2025-2026) 远程调试安全策略加固
- **强制绑定非默认数据目录**：若在默认 Chrome 目录中启用 `--remote-debugging-port`，Chrome 会静默忽略该参数并不开启端口；
- **私有网络访问控制 (PNA / LNA)**：Chrome 136+ 与后续版本将本地网络访问保护扩展到 WebSocket，阻断公共网页扫描 `127.0.0.1:9222`；
- **合规隔离**：Chat-Codex 采用专属路径 `master-seed-profile` 与 `sub-instance-1`，天然符合该加固规范。

### 4.3 彻底淘汰 VSS 提权，确立 CDP Browser Target 纯内存同步
- **VSS 淘汰原因**：WMI `Win32_ShadowCopy` 在普通非管理员运行环境下必然触发 `Access Denied (9)` 报错，且耗时高达 2500~3800ms；
- **CDP 内存直出实现**：连接 `http://127.0.0.1:9225/json/version`，通过 `Storage.getCookies` 导出 Cookie，注入 Worker（Port 9222）的 `Storage.setCookies`；
- **参数清洗规范**：`Storage.getCookies` 返回的 `Network.Cookie` 包含只读属性，回填至 `Storage.setCookies` 时必须清洗映射为符合 `Network.CookieParam` 规范的对象（剔除只读字段，规范化 `sameSite` 与 `expires`）；
- **实测性能**：**导出 78ms + 注入 27ms = 总耗时仅 105ms**，相较 VSS 提速 30 倍，零文件锁，零 UAC 提权。

---

## 5. 高并发动态 Jitter 调度与反风控机制

### 5.1 自适应非周期动态 Jitter 调度模型
OpenAI 边缘安全防护网关（Sentinel 与 Cloudflare Turnstile）配备了基于机器学习的时间序列聚类分析器：
- 固定等差步长（如严格 5.0 秒）的到达时间二阶差分方差接近于零（$\text{Var}(\Delta T) \approx 0$），极易被标记为机器人节拍；
- 调度引擎全面采用动态 Jitter 算法：
  $$\Delta T_k = T_{\text{base}} + \text{UniformRandom}(J_{\min}, J_{\max})$$
  基准步长 $T_{\text{base}} = 10000\text{ ms}$，随机波动分量 $J \in [1000\text{ ms}, 10000\text{ ms}]$，每次派发间隔随机分布在 **11.0s ~ 20.0s**，彻底打散请求时间特征，实现 **0 阻断、0 报错、0 验证码**。

### 5.2 React / ProseMirror 富文本框架事件合成规范
ChatGPT 前端输入框基于 ProseMirror `div[contenteditable=true]`：
```javascript
const el = document.querySelector('#prompt-textarea');
el.focus();
el.innerHTML = '<p>' + escapedText + '</p>';
el.dispatchEvent(new Event('input', { bubbles: true })); // 冒泡事件触发 React 状态树响应

// 轮询等待 React 水合完成，send-button 变为可用
for (let a = 0; a < 20; a++) {
    await new Promise(r => setTimeout(r, 200));
    const btn = document.querySelector('button[data-testid="send-button"]') || 
                document.querySelector('[data-testid="send-button"]');
    if (btn && !btn.disabled) {
        btn.click();
        break;
    }
}
```

### 5.3 2026 前沿反爬特征：网络层信号与原生 Chrome 零 JS 污染
- **Stealth 插件在现代 WAF 面前过时**：2025/2026 年 Cloudflare Turnstile 与 DataDome 将核心重心转移至**网络层信号（JA4 客户端指纹、TLS 1.3 Client Hello 扩展序列与顺序、HTTP/2 SETTINGS 帧行为）**；通过 JS 原型链注入（如 `puppeteer-extra-plugin-stealth` 伪造 `navigator.webdriver`）会被 WAF 的深层原型链校验秒级识别；
- **原生继承基准**：Chat-Codex 采用官方原版 Chrome 二进制启动，剔除 `--enable-automation`，底层网络栈由本地真实 BoringSSL 驱动，图形渲染由物理显卡 Direct3D/ANGLE 直出，具备 100% 真实的人类设备软硬件特征。

### 5.4 未决操作分类恢复状态机（杜绝盲目重放）
CDP WebSocket 断线后，严禁盲目整队重放：
```text
ACCEPTED → DISPATCHING → ACKNOWLEDGED → EFFECT_VERIFIED
                 ↘ UNKNOWN (断线或未确认)
```
- **只读查询**：使用全新请求 ID 重新查询；
- **配置与事件订阅**：在新 Target 会话上按配置全量重建；
- **写操作（点击/输入/提交）**：断线后标记为 `UNKNOWN`，重连后先查询会话树核对业务效果，确认未执行才允许重发，严禁直接自动二次点击。

---

## 6. Windows 进程生命周期、Job Object 与命名管道

### 6.1 Win32 `PROC_THREAD_ATTRIBUTE_JOB_LIST` 原子作业绑定
为防止终端会话关闭或 IDE 重启时级联杀死后台 Chrome 实例：
- 传统“创建挂起进程 -> `AssignProcessToJobObject`”存在竞态窗口；
- **2026 生产级规范**：使用 `STARTUPINFOEXW` 配合 `PROC_THREAD_ATTRIBUTE_JOB_LIST` 属性列表，在调用 `CreateProcessW` 时原子绑定独立的 `browserJob`；
- 兼容 Chromium 内部多进程沙箱的嵌套作业对象（Nested Jobs），外层 Job 严禁施加不当限制。

### 6.2 传输选型对比：TCP WebSocket vs Named Pipe
- **Chromium 调试管道断开致命机制**：Chromium 源码（`devtools_pipe_handler.cc`）证实，`--remote-debugging-pipe` 在管道读取端检测到 EOF（IDE 退出）时会直接触发 `CloseBrowserSoon` 终止 Chrome！因此 **Pipe 无法实现跨 IDE 进程保活**；
- **传输选型准则**：
  - **Keeper ↔ Chrome 调试通道**：**优先采用环回 TCP WebSocket**（支持 Keeper 重启后重新 attach 接管已存在的 Chrome）。配合 `--remote-debugging-port=0` 动态分配端口，读取数据目录下的 `DevToolsActivePort` 文件，彻底解决端口争用；
  - **Agent / IDE ↔ Keeper 通信**：**推荐采用自建 Named Pipe IPC**（带显式 DACL 权限控制、`PIPE_REJECT_REMOTE_CLIENTS` 与 Overlapped I/O / IOCP），杜绝未授权进程探测。

### 6.3 Windows Session 0 穿透与看门狗硬杀
- **Session 0 穿透**：通过在 `STARTUPINFO` 中显式指定 `si.lpDesktop = @"WinSta0\Default"` 或通过交互式计划任务穿透，消除后台服务模式下图形硬件加速设备创建失败的缺陷；
- **看门狗进程树硬杀**：调用 Windows 原生 `taskkill /PID {pid} /T /F`，遍历整棵进程树清理孤儿 Chrome 与测试子进程，杜绝文件句柄锁死。

---

## 7. 统一运行态存储拓扑与三级研报知识图谱

### 7.1 单一专用根原则 (`C:\GPT-Chat-codex-handoff\`)
所有运行态数据严格收敛在 `C:\GPT-Chat-codex-handoff\`，杜绝向外扩散：
- `master-seed-profile\`：Master 种子沙盒（Port 9225，人工登录保鲜专用）；
- `workers\`：动态 Worker 沙盒派发目录；
- `PassSearchHistory\`：最终结构化 Markdown 研报归档。

### 7.2 三级时段分桶拓扑与冲突防覆盖算法
- **三级归档路径**：`PassSearchHistory / [项目标识] / [YYYY-MM-DD] / [4h时段桶] / [标题.md]`；
- **4h 时间桶**：`00h-04h`, `04h-08h`, `08h-12h`, `12h-16h`, `16h-20h`, `20h-24h`；
- **冲突防覆盖保证**：目标文件已存在时比对 SHA-256 哈希，若内容不同自动追加计数后缀（`_1.md`），绝对保护历史数据不被覆盖。

### 7.3 自动化索引与 GraphRAG 知识图谱 (`index_builder.js`)
流水线任务完成后自动编排全局索引：
- 项目托盘图与摘要索引（`[Project]/README.md`）；
- 实体与时序关系图谱（`[Project]/codegraph.json`）；
- 全局聚合统计大盘（`PassSearchHistory/README.md`）。

---

## 8. 自动化 MCP 服务层与零信任代码采纳门禁

### 8.1 攻克 IDE 客户端 60s 硬超时：异步任务句柄模式 (Async Task Handle)
- **Stdio 挂起 60s 的灾难**：Anthropic 官方 `@modelcontextprotocol/sdk` 中的 `DEFAULT_REQUEST_TIMEOUT_MSEC` 明确硬编码为 **60,000ms (60秒)**。服务端挂起 60 秒必然导致 Claude Desktop、Cursor 抛出 `REQUEST_TIMEOUT (-32001)` 并摧毁会话；
- **异步任务句柄模式 (`lib/mcp-async-handle.js`)**：
  - 客户端调用 `chatgpt_reason`（带 `asyncHandle=true`）时，服务端在 **0.11ms** 内极速交付任务句柄（`taskId` 与 `status: AWAITING_HUMAN_INPUT` / `working`）；
  - 客户端通过后台短轮询查询状态，允许人类随时通过 `submit_review` 注入纠偏批注，彻底解耦人类思考时间与模型长程推理时间。

### 8.2 MCP 2026-07-28 规范演化适配
- 深度适配 2026 年最新官方 MCP 演化：长任务正式收敛至 `io.modelcontextprotocol/tasks` 扩展规范，通过 `tasks/get` 查询终态，通过 `tasks/update` 注入中途参数；
- 内部采用不可变任务模型，对外通过协议适配器同时支持新旧 MCP 客户端。

### 8.3 零信任本地采纳门禁与 Git Worktree 影子工作树沙盒
- 网页端返回数据一律标记为 **Untrusted Data**；
- 采纳验证时，系统动态创建 `artifacts/sandboxes/shadow-{taskId}/` 独立 Git Worktree 影子工作树；
- 补丁应用与离线单元测试均在影子沙盒中进行，测试失败直接安全卸载工作树，**主工作区保持绝对 0 污染**，杜绝未提交代码丢失风险。

### 8.4 JSONC 容错解析与客户端语法分流
- 采用微软标准 `jsonc-parser` 容错解析带 `//` 与 `/* */` 注释的配置文件；
- 自动化安装器识别客户端类型：VS Code 自动写入 `"servers"`，Cursor 与 Claude Desktop 自动写入 `"mcpServers"`，并绑定 Node 绝对执行路径 `process.execPath`。

---

## 9. 实机基准测试压测与故障注入验收矩阵

### 9.1 真实 Windows 实机性能压测基准 (Benchmarks)

| 场景机制 | 传统设计 / 旧版实现 | 现代落地生产方案 (Mainline Verified) | 实测性能基准提升 |
|---|---|---|---|
| **会话凭据同步** | VSS 卷影快照（耗时 2500~3800ms，需管理员特权） | **CDP Browser Target 纯内存导出与回填** | **耗时仅 105ms (提速 30 倍)**，普通权限 100% 成功 |
| **高频遥测监控** | PowerShell WMI `Win32_Process` 轮询（耗时 824ms） | **Win32 `K32GetProcessMemoryInfo` 原生调用** | **平均 3.54µs (提速 232,795 倍)**，CPU 占用趋于 0% |
| **MCP 长任务调度** | Stdio 挂起 60 秒（触发 IDE 客户端超时崩溃） | **异步任务句柄模式 (`lib/mcp-async-handle.js`)** | **0.11ms 极速交付**，彻底解耦长程推理时间 |
| **代码补丁门禁** | 直接覆盖本地工作区，失败则 `git reset --hard` | **Git Worktree 影子工作树沙盒隔离** | **主工作区 0 污染**，完全消除未提交代码丢失风险 |
| **配置文件解析** | 原生 `JSON.parse`（遇到 `//` 注释 100% 抛错） | **微软标准 `jsonc-parser` + 客户端语法分流** | **100% 容错解析注释**，自动适配 VS Code / Cursor |

### 9.2 全量自动化回归套件状态 (24/24 Passed)
- 离线单元测试集 (`tests/offline/`): 12 项测试 100% 通过；
- 工程可行性审计集 (`tests/feasibility/`): 8 项测试 100% 通过；
- 全流程 MVP 实机闭环测试 (`tests/mvp_full_flow.test.js`): 4 项测试 100% 通过；
- **全系统累计 24/24 项自动化测试全部通过**。

### 9.3 生产级 14 项故障注入验收矩阵
在正式交付前，系统必须通过以下 14 大故障注入断言：
1. **关闭终端 / 重启 IDE**：Keeper 与 Chrome 实例保持运行；
2. **杀死任务协调器 (Broker)**：Keeper 与 Chrome 保持，Broker 重启后从磁盘日志恢复；
3. **杀死常驻宿主 (Keeper)**：按预设策略重新拉起 Keeper 并重新接管 Chrome；
4. **Chrome 意外崩溃**：`browserEpoch` 递增，重建资源并向 Broker 报告实例重置；
5. **写操作时响应丢失**：标记为 `UNKNOWN`，重连先核对业务效果，严禁直接自动二次点击；
6. **S3 睡眠 / Modern Standby**：唤醒后进入恢复宽限期，三层探针依次核验；
7. **VPN 切换或网络断流**：分别判定本地 CDP 通道与远端 HTTP 流，不误动本地浏览器；
8. **大附件与长截图事件**：启用有界容量限制队列，超出限制降级采样；
9. **管道首实例被占用**：拒绝启动并记录冲突，严禁盲目连接未知管道；
10. **新旧 MCP 客户端混合**：根据协议协商自动分流；
11. **配置文件并发只写入一半**：保持上一份经过验证的内存配置；
12. **代码执行 Worker 死循环**：看门狗通过进程树硬杀清理专属 Worker Job；
13. **Git 主分支在验证期变更**：影子门禁拒绝基于旧基线的直接提交；
14. **RDP 桌面与 GPU 环境切换**：重新校验图形设备上下文与页面渲染水合状态。

---

## 10. 核心运行参数与 CLI 运维指令速查

```powershell
# 1. 运行系统环境预检 (探测 9225/9222/9223 端口与 Node/Git 状态)
node C:\code\Chat-Codex\handoff-core\bin\handoff.js doctor

# 2. 自动化检测并注入 VS Code / Cursor / Claude Desktop MCP 配置
node C:\code\Chat-Codex\handoff-core\bin\handoff.js setup

# 3. 启动通用 MCP 自动化服务 (标准 Stdio JSON-RPC 2.0 通信)
node C:\code\Chat-Codex\handoff-core\bin\handoff.js mcp

# 4. 运行全量自动化测试回归套件 (离线单测 + 可行性审计 + MVP 闭环: 24/24 Passed)
cd C:\code\Chat-Codex\handoff-core
node --test tests/offline/*.test.js tests/feasibility/*.test.js tests/mvp_full_flow.test.js

# 5. 驱动 Worker 1 执行深度检索并归档至 PassSearchHistory
node C:\code\Chat-Codex\handoff-core\pipeline\auto_chat_pipeline.js --port 9222 --file artifacts/query_task.json

# 6. 执行项目全量搜索历史索引与 CodeGraph 图谱自动化编排
node C:\code\Chat-Codex\handoff-core\bin\handoff.js index
```
