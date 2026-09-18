# WebChat-Assistant

企业级 WebChat 深度推理辅助引擎与母子沙盒 CDP 调度系统。

---

## 快速起步

### 1. 环境预检
```bash
node bin/assistant.js doctor
```

### 2. 自动安装 MCP 服务
```bash
node bin/assistant.js setup
```

### 3. 母子沙盒使用流程
1. 双击 `start_master.bat`（或执行 `node bin/assistant.js master`）启动母版沙盒 (Port 9225) 并登录 ChatGPT；
2. 执行 `node bin/assistant.js sync`，将登录态热注入 Worker 沙盒 (Port 9222)；
3. 执行推理任务：
   ```bash
   node bin/assistant.js chat "请联网搜索分析：2026年强化学习在自愈 Agent 上的最新进展"
   ```
4. 启动可视化监控控制台：
   双击 `start_gui.bat`（或执行 `node bin/assistant.js gui`）。
