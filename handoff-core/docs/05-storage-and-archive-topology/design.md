# 模块五：统一运行时存储与三级研报知识图谱 (Storage & Archive Topology)

本文档是 Chat-Codex 系统的运行态文件存储、三级结构化研报归档以及 GraphRAG 知识图谱自动化编排的设计规范。

---

## 1. 统一 Windows 运行态存储原则

为了彻底杜绝自动化运行产物分散污染系统盘、用户文档目录或各项目工作区，系统贯彻**严格收敛的单一存储原则**：
- **唯一专用根目录**：`C:\GPT-Chat-codex-handoff\`
- **集中管理范畴**：全部运行态数据（Master-Seed 种子沙盒、跨进程锁、动态 Worker、研报成果、执行流水与全局索引）一律收纳于该根路径下。

```text
====================================================================================================
               C:\GPT-Chat-codex-handoff\ 生产级统一存储全景拓扑
====================================================================================================

C:\GPT-Chat-codex-handoff\
├── runtime.local.json                  # 全局统一运行时配置中心 (优先级高于默认配置)
├── master-seed-profile\                # Master 种子沙盒 (Port 9225，人工登录保鲜专用)
│   ├── Default\ (Cookies, Local Storage, Preferences)
│   └── Local State (os_crypt DPAPI 密钥)
│
├── workers\                            # 动态 Worker 沙盒派发目录
│   ├── worker-9222\ (链接或复用 sub-instance-1)
│   └── worker-9223\ (链接或复用 sub-instance-2)
│
├── runs\                               # 批量流水数据与调试日志
│   └── results.json                    # 结构化调度中间状态与指标
│
└── PassSearchHistory\                  # 结构化最终研报归档库 (三级目录拓扑)
    ├── README.md                       # 全局聚合大盘与所有项目的一级索引
    │
    ├── [Project-A]\                    # 开发项目分类 A (如 GPT-Chat-codex-handoff)
    │   ├── README.md                   # 项目独占 ASCII 托盘图与研报速查表
    │   ├── codegraph.json              # 实体节点、时序边与上下文依赖图谱 (GraphRAG)
    │   └── YYYY-MM-DD\                 # 日期分层
    │       ├── 00h-04h\*.md            # 4小时精确时段分桶归档
    │       ├── 04h-08h\*.md
    │       └── 20h-24h\*.md
    │
    └── [Project-B]\                    # 开发项目分类 B (如 turnel 等)
        ├── README.md
        ├── codegraph.json
        └── YYYY-MM-DD\*.md
```

---

## 2. 三级结构化研报归档规范 (`PassSearchHistory`)

### 2.1 目录分层拓扑与时间桶算法
归档文件路径严格遵循三级拓扑：
`PassSearchHistory / [项目标识] / [YYYY-MM-DD] / [4h时间桶] / [标题.md]`

- **4 小时时间桶算法**：
  根据任务创建的 Unix Epoch 时间戳，映射到 6 个固定时段桶：
  - `00h-04h`, `04h-08h`, `08h-12h`, `12h-16h`, `16h-20h`, `20h-24h`
- **冲突防覆盖保证 (`lib/archive-writer.js`)**：
  若目标目录中已存在同名 Markdown 文件，落盘引擎计算内容 SHA-256 哈希。若内容不同，自动追加 `_1.md`、`_2.md` 计数后缀，**严禁静默覆盖历史研究成果**。

### 2.2 规范化 Markdown 元数据 Frontmatter 契约
每篇落盘的研报正文顶部必须包含标准元数据信息头：

```markdown
# [官方会话标题 / Prompt 提炼标题]

> **元数据信息 (Metadata)**
> - **会话标识 (Conversation ID)**: `6a9d3787-d2b4-83e8-b58d-3de62014118d`
> - **所属开发项目 (Project)**: `GPT-Chat-codex-handoff`
> - **项目物理地址 (Project Path)**: `C:\code\Chat-Codex\handoff-core`
> - **官方生成标题**: 提升传输稳定性
> - **重试配置 (Retry Limit)**: 上限: **2** 次 | 实际重试: **0** 次
> - **处置状态**: ✅ 深度推理与全网检索完成 (完整输出)
> - **本地接管标记 (Delegation Flag)**: `NONE` (云端直出) / `[DELEGATED_TO_LOCAL_SEARCH]`
> - **创建时间 (Created At)**: 2026-09-06 02:51:09
> - **更新时间 (Updated At)**: 2026-09-06 03:03:48
> - **所属时段桶 (Time Bucket)**: `2026-09-06 / 00h-04h`
> - **在线会话链接 (URL)**: https://chatgpt.com/c/...
> - **字数统计**: Prompt: 790 字 | 回复正文: 25756 字

---

## 1. 原始提问 (User Prompt)
...

---

## 2. 联网检索轨迹 (Web Searches & Citations)
1. **[Search Tool]**: `Chromium devtools_pipe_handler.cc`
2. **[Search Tool]**: `Win32 PROC_THREAD_ATTRIBUTE_JOB_LIST`

---

## 3. 完整深度回复 (Assistant Markdown Content)
...
```

---

## 3. 自动索引构建与 GraphRAG 知识图谱编排 (`index_builder.js`)

在任务落盘后，流水线自动触发全局索引编排，保持知识库的高可检索性：

1. **项目托盘图与摘要索引 (`[Project]/README.md`)**：
   - 自动扫描该项目下全部 Markdown 文档；
   - 提取标题、字数、耗时、重试次数与标签；
   - 生成精美的 ASCII 托盘图与 Markdown 汇总表格。
2. **实体知识拓扑 (`[Project]/codegraph.json`)**：
   - 构建符合 GraphRAG 规范的图谱文件；
   - 记录会话实体、包含的关键符号、被引用的系统 API 与时序因果关联边。
3. **全局聚合大盘 (`PassSearchHistory/README.md`)**：
   - 聚合统计全系统总研报数、累计字数、项目分布比例与近期活跃动态。
