# ⚠️ 历史技术攻关只读镜像归档（全量 65 个脚本永久冻结与过期）

> **【DEPRECATED & ARCHIVED 归档防误用告示】**
> 
> **声明**：本目录（`handoff-core/experiments/legacy/old-root/`）为 Chat-Codex 系统早期技术攻关、反爬逆向与可行性探索的**历史只读镜像归档**。
> 
> **本目录下的全部 65 个脚本、测试文件及原型数据集已 100% 正式废弃并永久冻结（STATUS: EXPIRED / DEPRECATED / READ-ONLY）！**
> 
> **⛔ 绝对执行禁令**：严禁任何外部 Agent、自动化流水线或开发者在此目录下执行任何脚本、安装依赖或将本目录代码引入生产主干！

---

## 1. 65 个历史脚本分类索引速查

| 分类大项 | 数量 | 包含代表性文件 | 状态 | 核心弃用根因 |
|---|:---:|---|:---:|---|
| **批处理与 PowerShell 运维脚本集** | 17 个 | `launch_dual_instances.ps1`, `vss_sync_full.ps1`, `start_sub1.bat`, `test_abe.ps1`, `test_elev.ps1` 等 | `[EXPIRED]` | VSS 依赖 UAC 管理员提权；脱机克隆受制于 Chrome 127+ App-Bound 加密边界；被 CDP 纯内存凭据回填替代。 |
| **Python Cookie 与安全解密工具集** | 13 个 | `test_decrypt.py`, `inspect_cookies.py`, `check_cookie_expiry.py`, `query_cdp_cookies.py` 等 | `[EXPIRED]` | 本地 DPAPI AES-GCM 无法解密 Chrome 127+ v20 凭据；违背免编译与纯 Node 原生原则；被 CDP 内存直出替代。 |
| **CDP 与 DOM 逆向探针脚本集** | 20 个 | `check_composer.js`, `find_pow_script.js`, `install_hook.js`, `test_input.js`, `trigger_send.js` 等 | `[EXPIRED]` | 历史探索探针，缺乏超时与状态机守护；核心成果（ProseMirror `<p>` 注入与冒泡事件合成）已全量重构入主干。 |
| **调度流水与协议测试脚本集** | 15 个 | `dispatch_10_staggered.js` (旧原型), `test_conv_api.js`, `test_raw_fetch.js`, `test_sentinel.js` 等 | `[EXPIRED]` | 证明脱机 HTTP fetch 会遭 Cloudflare 403 拦截；5s 固定步长易被风控聚类；已升级为非周期随机抖动调度。 |

---

## 2. 权威架构与现代替代指引

要了解 65 个文件的具体设计初衷、逆向技术沉淀（VSS 卷影快照、Windows DPAPI、ProseMirror 水合机制、Cloudflare 403 证伪经验）以及现代主干对应关系，请阅读：

👉 **[docs/HISTORICAL_SCRIPTS_KNOWLEDGE_BASE.md](file:///C:/code/Chat-Codex/docs/HISTORICAL_SCRIPTS_KNOWLEDGE_BASE.md)**

要进行标准跨工作区 Agent 集成或命令行调用，请严格查阅根目录规范：

👉 **[AGENTS.md](file:///C:/code/Chat-Codex/AGENTS.md)**

---

## 3. 生产主干现代调用方式（仅在 handoff-core 下）

```powershell
# 1. 环境健康检查 (替代 check_seed_vss.ps1, test_auth_reqs.js)
node C:\code\Chat-Codex\handoff-core\bin\handoff.js doctor

# 2. 纯 Chat 模式极速推理 (替代 trigger_send.js, test_conv_api.js)
node C:\code\Chat-Codex\handoff-core\bin\handoff.js chat "你的技术问题" --surface chat

# 3. 生产级 10 路错峰调度 (替代 old-root/dispatch_10_staggered.js)
node C:\code\Chat-Codex\handoff-core\pipeline\dispatch_10_staggered.js

# 4. MCP 自动化协议服务 (供外部 Agent 工具调用)
node C:\code\Chat-Codex\handoff-core\bin\handoff.js mcp
```
