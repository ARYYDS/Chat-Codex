# WebChat-Assistant 架构规范与 Agent 交互指南

本文档定义了 `C:\code\Chat-Codex\WebChat-Assistant` 的系统定位、MCP 协议契约、母子浏览器架构与开发守则。

---

## 1. 系统核心设计原则

1. **绝对独立闭环**：全套业务逻辑（CDP 连接、母子热同步、两阶段流控、研报落盘、GUI 与 Tauri）均收敛在本目录，不依赖任何外部测试脚本或临时碎屑。
2. **母子沙盒解耦 (Dual-Tier CDP Architecture)**：
   - **母版沙盒 (Master Port 9225)**：人工安全登录 ChatGPT，不进行任何自动化爬虫；
   - **Worker 沙盒 (Port 9222/9223)**：自动化推理执行，通过 CDP `Network.setCookies` 接收母版凭据动态热注入。
3. **两阶段 MCP 任务协议 (Two-Phase Protocol)**：
   - 长程任务在 <500ms 内返回 `{ resultType: 'task', status: 'ACCEPTED', taskId }`，免疫客户端 60 秒硬超时；
   - 客户端通过 `action: 'fetch_result'` 轮询或提取落盘的 7 章节 Markdown 报告。
4. **双轨滑动窗口流控 (SlidingWindowLimiter)**：
   - Chat（2~4 槽位）与 Work（1~2 槽位）物理配额隔离，防止队头阻塞。
5. **双阶停滞看门狗与物理单任务强停**：
   - 45~60 秒字符静止自动感知；支持物理点击 Stop 按钮。

---

## 2. CLI 统管命令集 (`bin/assistant.js`)

| 命令 | 说明 |
|---|---|
| `node bin/assistant.js doctor` | 运行时全面健康体检 (Master, Worker, Paths, Node) |
| `node bin/assistant.js setup` | 自动侦测并注入 Antigravity / Cursor / Claude MCP 配置 |
| `node bin/assistant.js sync` | 从母版 9225 提取登录态并热同步至 Worker 9222/9223 |
| `node bin/assistant.js chat "<prompt>"` | 直接向 Worker 派遣问答任务并生成研报 |
| `node bin/assistant.js gui` | 启动 Web GUI (Port 8765) 与 SSE 推流大盘 |
| `node bin/assistant.js mcp` | 启动标准 Stdio JSON-RPC 2.0 MCP 服务 |
| `node bin/assistant.js master` | 拉起母版登录浏览器 (Port 9225) |
| `node bin/assistant.js worker` | 拉起 Worker 自动化沙盒浏览器 (Port 9222) |
