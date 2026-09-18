# Chat-Codex Handoff Core (生产主干)

> **核心地位**：本项目所有生产流水线、Stdio MCP 服务、CLI 运维工具与离线单元测试全部收敛在 `handoff-core/` 目录下。纯原生 Node.js 驱动，零额外编译依赖。

---

## 1. 目录架构与模块拓扑 (Directory Layout)

```text
handoff-core/
├── bin/
│   └── handoff.js                  # 统一 CLI 生产入口 (doctor | chat | sync | index | gui | mcp | setup)
│
├── mcp/                            # 标准 Stdio JSON-RPC 2.0 MCP 服务实现
│   ├── index.js                    # MCP 服务启动挂载点
│   ├── server.js                   # JSON-RPC 2.0 调度协议栈与 stdout/stderr 安全隔离
│   ├── tools.js                    # 6 大核心 MCP 工具实现 (reason, doctor, verify, upload 等)
│   └── resources.js                # MCP 资源定义 (运行时状态与历史索引)
│
├── gui/                            # 现代化轻量 HTTP + SSE 原生桌面服务
│   ├── server.js                   # HTTP/SSE 后端服务 (默认 Port 8765)
│   └── public/                     # 控制台静态资源与前端渲染层
│
├── pipeline/                       # 核心自动化调度与归档管线
│   ├── auto_chat_pipeline.js       # 单任务/批量调度、ProseMirror 注入与四重互锁收敛
│   ├── dispatch_10_staggered.js    # 10 路错峰梯度并发调度引擎
│   ├── index_builder.js            # 自动化 Markdown 索引与 CodeGraph 图谱生成
│   └── sync_search_history.js      # 历史研报同步与清理
│
├── lib/                            # 核心基础库与运行时驱动
│   ├── surface_manager.js          # Chat vs Work 模式档位控制、四重互锁状态机与物理 Stop
│   ├── cdp-cookie-manager.js       # CDP 纯内存 105ms 凭据提取与热回填
│   ├── sliding_window_limiter.js   # 双轨配额隔离、背压拒绝与排队熔断
│   ├── stall_watchdog.js           # 停滞 Watchdog 探针与僵尸按键恢复
│   ├── process-tree-guard.js       # Windows 进程树原子挂载与硬杀灭守护
│   ├── git-shadow-sandbox.js       # Git Worktree 影子沙盒补丁无损测试
│   ├── mcp-async-handle.js         # 双阶段异步任务票据管理器 (<1ms 防超时)
│   ├── token_counter.js            # 多语言 Token 动态核算与账本追加
│   ├── jsonc-config-dispatcher.js  # JSONC 注释兼容解析与 IDE 自动配置注入
│   ├── archive-write.js            # 原子化时段落盘防损坏写入
│   └── runtime-config.js           # 全局配置中心与自适应项目解析
│
├── tests/
│   └── offline/                    # 43 个纯离线确定性单元测试 (100% 通过)
│
└── experiments/
    └── legacy/                     # 历史攻关脚本归档镜像 (已标记过期，请勿直接调用)
```

---

## 2. 统一 CLI 生产命令指引 (CLI Usage)

所有操作均通过统一 CLI 入口 `node bin/handoff.js` 驱动：

```powershell
# 1. 毫秒级环境与浏览器沙盒自检
node bin/handoff.js doctor --browser

# 2. 查看当前运行时配置与解析出的项目标识
node bin/handoff.js config

# 3. 发起纯 Chat 模式极速推理 (推荐小任务/咨询/评审)
node bin/handoff.js chat --prompt "请用一句话解释TCP三次握手的核心目的" --surface chat

# 4. 指定外部项目上下文与所属分类执行推理
node bin/handoff.js chat --project "C:\code\turnel" --project-id turnel --prompt "分析网络层边界" --surface chat

# 5. 启动独立审查房间 (critic 房间，隔离历史会话上下文)
node bin/handoff.js chat --prompt "审查目标代码" --surface chat --room critic

# 6. 一键启动 Stdio MCP 协议服务 (供 IDE 调用)
node bin/handoff.js mcp

# 7. 一键启动桌面可视化控制台
node bin/handoff.js gui --port 8765

# 8. 自动检测与安装 IDE MCP 配置
node bin/handoff.js setup --install all
```

---

## 3. 质量保障：43 项纯离线单元测试 (Offline Test Suite)

本项目具备严苛的质量保障体系，43 个纯离线测试用例无需真实网络和浏览器，在秒级内完成断言校验：

```powershell
node --test tests/offline/*.test.js
```

### 核心断言覆盖：
- **MCP 协议与异步解耦**：验证 Stdio JSON-RPC 2.0、两阶段票据机制（`<1ms` 返还）以及 stdout 纯净性；
- **表面与档位状态机**：断言 Chat/Work 档位切换与四重互锁终态收敛逻辑；
- **滑动窗口与看门狗**：验证双轨配额隔离、背压拒绝、停滞 Watchdog 超时检测与物理 Stop 按钮兜底；
- **凭据与进程隔离**：验证纯内存 Cookie 导出回填、进程树硬杀与 Git Worktree 影子沙盒；
- **持久化与索引安全**：验证原子落盘、重复写入幂等性保护与 CodeGraph 增量构建。

---

## 4. 运行时数据与配置规则 (Configuration & Data)

- **默认全局配置文件**：`C:\GPT-Chat-codex-handoff\runtime.local.json`
  - 可通过环境变量 `HANDOFF_CONFIG` 自定义指定配置路径；
  - 规范字段示例见 `config.example.json`。
- **全局统一运行时数据中心**：`C:\GPT-Chat-codex-handoff\`
  - `PassSearchHistory/`：三级分层落盘知识库（`[项目]/[YYYY-MM-DD]/[HHh-HHh]/[标题].md`）；
  - `master-seed-profile/`：Chrome 母版环境（Port 9225）；
  - `.runtime/state/`：跨进程锁与活跃会话状态。

---

## 5. 相关参考链接

- 根目录综合大盘：[README.md](../README.md)
- 外部 Agent 契约与调用指南：[AGENTS.md](../AGENTS.md)
- 详细 MCP 调用与 IDE 集成教程：[调用教程/README.md](../调用教程/README.md)
- 核心设计蓝图与架构解耦总纲：[docs/design.md](../docs/design.md)
