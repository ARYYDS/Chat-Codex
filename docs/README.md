# Chat-Codex 核心设计规范与模块化架构指南 (docs/)

欢迎查阅 Chat-Codex 系统的官方架构与系统工程设计文档。

本目录已于 **2026 年 9 月** 依据 `AGENTS.md` 规范完成系统性解耦，将历史庞大的单体设计文档拆分为 7 个职责单一、高内聚、已去除工程幻觉的专题模块，并经过了真实实机测试回归（24/24 项全通）与在线 ChatGPT 深度检索校验。

---

## 快速导航地图 (Architecture Navigation Map)

```text
C:\code\Chat-Codex\docs\
├── design.md                                  # [权威主蓝图] 顶层设计总纲与去幻架构速查 (v2.5.0-Verified)
├── README.md                                  # [本文档] 目录导航与子模块架构索引
├── HISTORICAL_SCRIPTS_KNOWLEDGE_BASE.md       # [技术攻关知识库] 65 个历史脚本系统性盘点、逆向技术沉淀与过期标记
│
├── 01-architecture-overview/                  # 模块一：核心架构演进与双层子母/双脑协同模型
│   └── design.md                              # 包含 L0/L1/L2 解耦拓扑、Keeper-Broker 模式与六大不变量
│
├── 02-security-and-credentials/               # 模块二：Windows 凭据安全与零特权内存同步规范
│   └── design.md                              # 包含 Chrome 127+ ~ 152+ App-Bound 边界、CDP 105ms 纯内存导出回填
│
├── 03-dispatch-and-anti-risk/                 # 模块三：高并发自适应错峰调度与反风控机制
│   └── design.md                              # 包含非周期随机抖动调度、ProseMirror 事件注入、四态未决恢复状态机
│
├── 04-windows-process-and-desktop/            # 模块四：Windows 进程生命周期、Job Object 与桌面穿透
│   └── design.md                              # 包含 PROC_THREAD_ATTRIBUTE_JOB_LIST 原子绑定、管道 EOF 机制、进程树硬杀
│
├── 05-storage-and-archive-topology/           # 模块五：统一运行时存储与三级研报知识图谱
│   └── design.md                              # 包含 C:\GPT-Chat-codex-handoff\ 单一根原则、4h 时间桶、GraphRAG 索引
│
├── 06-mcp-protocol-and-adoption-gate/         # 模块六：自动化 MCP 服务层与零信任代码采纳门禁
│   └── design.md                              # 包含 MCP 2026-07-28 Tasks 规范、异步任务句柄防 60s 超时、Git Worktree 沙盒
│
├── 07-upstream-comparisons-and-benchmarks/    # 模块七：上游方案解构、实机基准测试与验收矩阵
│   └── design.md                              # 包含 codex-bridge 与 pro-plugin 借鉴、23 万倍遥测性能实测、14 大故障注入矩阵
│
├── GUI客户端设计/                             # GUI 客户端前端展示规范 (Tauri 2.0 / Rust)
│   └── design.md
│
└── 工程幻觉偏移分析修复/                      # 工程可行性实机审查报告与 5 项真实测试断言
    ├── design.md
    ├── test_01_vss_vs_cdp_cookies_result.md
    ├── test_02_mcp_async_handle_result.md
    ├── test_03_git_worktree_sandbox_result.md
    ├── test_04_installer_jsonc_dispatch_result.md
    └── test_05_telemetry_benchmark_result.md
```

---

## 核心演进与治理原则
1. **单一事实源 (Single Source of Truth)**：任何新特性与架构变动，需同步更新对应子目录下的 `design.md` 与顶层 `docs/design.md`；
2. **零信任与去幻要求**：严禁在设计中假设不可行、未经实机断言的特权操作（如无管理员权限下的 VSS 卷影快照、长达 60s 的 Stdio 同步阻塞等）；
3. **主干代码收敛**：所有核心业务逻辑与 CLI 运维入口一律收敛于 `handoff-core/`。
