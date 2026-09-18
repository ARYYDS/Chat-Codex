# WebChat-Assistant 系统核心架构与设计规范

## 1. 系统定位与核心愿景
WebChat-Assistant 是专为 AI 编码代理（如 Antigravity, Cursor, Claude Code, VS Code Cline）打造的企业级免 API Key 双脑协同底座。通过非侵入式母子浏览器 CDP 协议穿透与全双工自动化通道，将 ChatGPT 网页端超级思考算力（o1/o3/ChatGPT Pro）无缝引入本地编码工作区。

## 2. 核心架构拓扑与六大模块解耦
- **母子浏览器隔离架构 (Dual-Tier CDP Isolation)**：
  - **Master 种子沙盒 (Port 9225)**: 人工登录保活，杜绝自动化污染与指纹异常，保持永久有效认证。
  - **Worker 运行时沙盒 (Port 9222/9223)**: 专用于自动化调度，零凭据落盘，任务完成即销毁 Tab 释放 Blink/V8 内存。
- **内存凭据零特权热分发 (Zero-Privilege Memory Cookie Distribution)**:
  - 彻底抛弃 Windows VSS 卷影复制提权与 SQLite 文件锁破解。
  - 直接调用 CDP `Storage.getCookies` 与 `Storage.setCookies` 在 Chromium 进程内存层实现毫秒级会话穿透与安全同步。
- **双轨滑动窗口限流排队机 (Dual-Track Sliding Window Limiter)**:
  - 严格区分 `chat`（高频轻量推理，2~4并发）与 `work`（深度长耗时 Canvas/o3 任务，1~2并发）。
  - 基于队列挂起与事件驱动，彻底杜绝多任务并发导致的网页卡顿与 Cloudflare 风控。
- **两阶段异步票据握手机制 (Two-Phase Async Handle)**:
  - 解决 IDE/Agent Stdio JSON-RPC 60s 硬超时与队头阻塞问题。
  - 派发任务在 500ms 内极速返回 `ACCEPTED` 与唯一 `taskId`，由 Agent 自主调用 `fetch_result` 轮询结果。
- **ProseMirror 物理注入与 45s 防卡死单任务物理熔断 (Surface Manager)**:
  - 通过 CDP `Input.insertText` 绕过 React 19 / ProseMirror 状态死锁。
  - 针对单任务精准识别并物理点击对应 Tab 的 `Stop` 按钮实现单任务熔断，不影响其他并发任务。
- **Tauri 2.0 原生轻量化桌面客户端 (Chat-Codex Studio)**:
  - 独立 Rust + Webview2 编译，体积仅 8.6MB，物理常驻系统托盘，实时可视化监控 Master/Worker 状态与错峰流水。

## 3. 核心优势归纳
1. **零 API 成本与极致安全**：免除高昂商业 API 账单，依托 Master/Worker 双沙盒隔离与 CDP 内存直读，在零提权、零凭据泄露的前提下实现 ChatGPT Pro 算力完全释放。
2. **防超时与高并发高可用**：通过两阶段异步票据（<500ms 快速响应）与双轨动态滑动窗口排队，彻底消除 IDE 队头阻塞与单任务卡死，构建了从提示词下发、物理文件上传到 7 章节研报落盘的完整工业级闭环。
