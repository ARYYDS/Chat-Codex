# 模块六：自动化 MCP 服务层与零信任代码采纳门禁 (MCP & Adoption Gate)

本文档是 Chat-Codex 系统的 **Model Context Protocol (MCP)** 服务暴露接口、异步任务句柄调度、以及 Git Worktree 零信任影子工作树采纳门禁的核心设计规范。

---

## 1. 自动化 MCP 服务架构与 2026-07-28 规范演化

系统将浏览器端原生 CDP 驱动、多路错峰排队、流式提取与上下文契约完整封装在开放标准的 MCP Server 中，对外统一以标准 Stdio JSON-RPC 2.0 暴露。

### 1.1 MCP 规范演进对齐 (2025-11-25 $\to$ 2026-07-28)
系统设计与 2026 年最新官方 MCP 演进保持严格一致：

| 机制维度 | 2025-11-25 规范 | 2026-07-28 规范 | Chat-Codex 落地适配标准 |
|---|---|---|---|
| **能力发现** | `initialize` 单次静态协商 | 每请求携带能力，通过 `server/discover` 动态发现 | 支持双模协商，对外声明兼容版本 |
| **异步长任务 (Tasks)** | 实验性临时工具扩展 | 成为标准化扩展 `io.modelcontextprotocol/tasks` | 返回 `resultType: "task"`，客户端通过 `tasks/get` 轮询 |
| **中途交互与输入** | 依赖中断重发 | 通过 `tasks/update` 提交人类补充输入 | 支持向在途任务注入人类批注与引导词 |
| **保持连接与重投** | 依赖协议 Ping 与 SSE 重投 | 移除协议 Ping，移除 `Last-Event-ID` 重投 | 任务状态持久化，客户端凭 `taskId` 断线重连 |

### 1.2 核心 MCP Tools 接口规格

```text
====================================================================================================
               Chat-Codex MCP 核心工具矩阵 (Tools Schema)
====================================================================================================

 1. chatgpt_reason (核心推理调度)
    * 参数: prompt (必填), roomId (main|debug|critic), reasoningEffort, attachRepo, timeoutMs, asyncHandle
    * 行为: 组装 6 大段落 Context Packet，经 CDP 发送至 Web 端，流式抓取后返回 7 大段落结构化建议。
    * 特性: 当 asyncHandle=true 时，立即返回 AWAITING_HUMAN_INPUT 或 taskId，解耦长程超时。

 2. chatgpt_upload_context (代码上下文打包上传)
    * 参数: includePaths, excludePatterns, maxFileBytes
    * 行为: 扫描代码树并过滤敏感密钥，生成 Monofile 单文件附件，经 CDP DOM 上传突破输入框限制。

 3. chatgpt_session_manage (会话房间映射管理)
    * 参数: action (list|switch|reset|archive), roomId, projectRoot
    * 行为: 实现不同工程与任务语义会话的物理隔离。

 4. chatgpt_doctor (系统就绪与健康检查)
    * 行为: 探测 9225/9222 端口可用性、内存 Cookie 有效期、Cloudflare 状态与模型配额。

 5. chatgpt_adoption_verify (本地代码采纳门禁)
    * 参数: patchContent, testCommand, runInShadow
    * 行为: 在独立影子工作树中应用补丁并限时运行单元测试，阻断不可信代码污染主工作区。
```

---

## 2. 攻克 IDE 客户端 60s 硬超时：异步任务句柄模式 (Async Task Handle)

### 2.1 传统“寸止 MCP / Stdio 挂起 60s”的工程灾难
在早期的所谓“寸止 MCP”方案中，尝试在 `tools/call` 的 Stdio 管道中直接挂起 Promise 60 秒以等待人工仲裁：
- **实测崩溃**：主流 IDE 客户端（Claude Desktop、Cursor）对单个 Tool Call 均硬编码了 60 秒客户端超时；
- 超时到达瞬间，客户端直接抛出 `-32001 Request timed out` 并强制破坏对话上下文；当 MCP 服务后续尝试向已关闭的标准输出写入数据时，直接触发 `EPIPE / ERR_STREAM_DESTROYED` 崩溃。

### 2.2 生产级异步任务句柄架构 (`lib/mcp-async-handle.js`)

```text
====================================================================================================
               异步任务句柄防超时状态机 (Async Task Handle Protocol)
====================================================================================================

      IDE / Agent 客户端                           MCP 自动化服务中枢
     ────────────────────                         ────────────────────
       tools/call(reason) ──[asyncHandle=true]───►  创建任务状态持久化
                                                    立即交付句柄 (耗时 0.11ms)
                          ◄───[返回 taskId]───────── (彻底免疫客户端 60s 超时)
              │
              ▼ (后台短轮询 <1ms)
       check_task(taskId) ───────────────────────►  返回当前状态:
                          ◄───[AWAITING_INPUT]──────
              │
              ▼ (人类输入纠偏)
       submit_review(...) ───────────────────────►  注入人类审查指示词
                          ◄───[ACCEPTED]────────────
              │
              ▼ (最终提取)
       check_task(taskId) ───────────────────────►  生成完毕，返回最终 7 章节研报
                          ◄───[COMPLETED]───────────
```

- **实测表现**：任务句柄在 **0.11ms** 内极速交付，既满足无人值守自动化轮询，又允许在人工介入时灵活暂停，且永不触发客户端超时断流。

---

## 3. 零信任本地代码采纳门禁与 Git Worktree 影子沙盒

### 3.1 零信任原则（Zero-Trust Adoption）
网页端大模型输出的一切代码建议、Shell 命令与补丁一律标记为 **Untrusted Data**：
- 严禁通过管道直接对用户当前的工作区执行文件覆盖；
- 严禁在主分支上执行失败即 `git reset --hard` 的危险操作（会导致用户尚未暂存的本地修改被永久抹杀）。

### 3.2 Git Worktree 影子工作树物理隔离标准 (`lib/git-shadow-sandbox.js`)
系统在每次验证代码建议时，动态开辟完全隔离的影子沙盒：

1. **动态挂载影子沙盒**：
   在 `artifacts/sandboxes/shadow-{taskId}/` 创建基于当前 Git HEAD 的只读影子工作树（`git worktree add`）；
2. **隔离应用补丁与编译验证**：
   在影子工作树内执行 `git apply`，并由看门狗守卫限时运行离线单元测试；
3. **主工作区绝对零污染**：
   - 若补丁格式错误或单测失败，直接硬杀测试进程并安全卸载影子目录（`git worktree remove --force`）；
   - 只有通过全部门禁断言时，才生成带 SHA-256 签名的审查通过回执，允许用户一键合入主工作区。

---

## 4. 异构配置分流与 JSONC 注释容错解析 (`lib/jsonc-config-dispatcher.js`)

由于各大 IDE 客户端的 MCP 配置文件格式存在语法分裂：
1. **JSONC 注释兼容**：用户配置文件（如 `cursor-settings.json`、`claude_desktop_config.json`）常包含 `//` 或 `/* */` 注释，原生 `JSON.parse` 100% 报错崩溃。系统采用微软标准 `jsonc-parser` 安全解析；
2. **客户端配置语法分流**：
   - VS Code 使用 `"servers"` 键名；
   - Cursor 与 Claude Desktop 使用 `"mcpServers"` 键名；
   - 自动化安装注入引擎根据探测到的 IDE 类型自动分流键名，并强制将 `node` 替换为 `process.execPath`（绝对路径），杜绝 GUI 环境变量缺失引发的 `ENOENT` 异常。
