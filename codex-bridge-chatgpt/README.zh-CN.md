# Codex 桥接 ChatGPT

[English](README.md) | **简体中文**

[![CI](https://github.com/anightmonarch/codex-bridge-chatgpt/actions/workflows/ci.yml/badge.svg)](https://github.com/anightmonarch/codex-bridge-chatgpt/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-0.2.0-10a37f)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-43853d)](package.json)

一个开源的 Codex Skill 和 Plugin-ready 项目：把复杂仓库任务的高成本推理交给 ChatGPT 网页端，同时把证据收集、文件修改、测试和最终判断保留在 Codex 本地。

```text
$codex-bridge-chatgpt 诊断这个复杂 Bug，完成修复并在本地验证。
```

不需要单独执行 setup 命令，不需要 OpenAI API Key，不运行后台服务。首次任务会先要求用户明确决定是否接受浏览器自动化风险；接受后才进入全自动交接流程。

> **Unofficial Experimental（非官方实验功能）：** 自动控制 ChatGPT 网页端存在非零账号风险，可能触发安全机制、临时限制或账号处置。本项目与 OpenAI 无关联，也未获得其认可或授权；不能保证合规、账号安全、模型可用性或 ChatGPT/Codex 额度永久分离。用户明确接受风险前，全自动桥接默认关闭。

![Codex 桥接 ChatGPT 架构](assets/codex-bridge-chatgpt-architecture.png)

可维护图源：[docs/architecture/codex-bridge-chatgpt-v1.architecture.json](docs/architecture/codex-bridge-chatgpt-v1.architecture.json)。

## 为什么做这个项目

复杂调试、架构设计和多方案权衡通常需要更强的推理能力；仓库搜索、文件修改和测试则应该留在本地工作树中完成，这样每个事实都能重新核验，每个修改都能实际测试。

Codex 桥接 ChatGPT 把职责拆开：

| 职责 | 负责人 |
|---|---|
| 读取项目规则、代码、测试和工作树状态 | Codex |
| 最小化、脱敏项目证据 | Codex |
| 完成高成本推理 | ChatGPT 网页端 |
| 判断哪些建议可信 | Codex |
| 修改文件、执行命令 | Codex |
| 运行测试、判断是否完成 | Codex |

ChatGPT 负责提出方案，Codex 负责验证与执行。

## 核心功能

- 用户只需要提交一句自然语言任务。
- 首次交接前自动运行 Doctor。
- 任何 ChatGPT 浏览器操作前必须通过版本化风险授权。
- 检查桌面 App、内置 Browser、ChatGPT 登录和目标模型。
- 把决定性项目证据压缩为 1–3K approximate-token Context Packet。
- 发送前移除疑似凭据和无关项目内容。
- 只使用 Codex 内置 Browser，不借用普通浏览器登录态。
- 要求 ChatGPT 返回结构化 Reasoning Result。
- 始终把网页输出当作不可信数据。
- 将每条建议记录为 `accepted`、`rejected` 或 `deferred`。
- 基于当前本地仓库重新构造修改和测试命令。
- 使用 SHA-256 绑定 Packet、Result、浏览器证据和运行回执。
- 只有确定性的 `complete` 闸门通过后才允许宣布完成。

## 工作流

1. **一句话调用**：用户在真实仓库任务中点名 `$codex-bridge-chatgpt`。
2. **自动预检**：Doctor 校验 Skill 安装和本地运行时。
3. **风险决策**：Skill 明确说明非零风险，只在用户完成版本化授权后继续。
4. **浏览器检查**：Codex 检查桌面环境、内置 Browser、ChatGPT 登录和目标模型。
5. **本地取证**：Codex 读取项目规则、状态、相关代码和测试。
6. **上下文压缩**：Codex 生成一个有界、脱敏的 Context Packet。
7. **网页推理**：只激活一次可见发送控件，获取一个结构化方案。
8. **可见复制**：只使用 ChatGPT 可见的“复制回答”操作；状态不确定立即停止。
9. **本地采纳门**：Codex 独立验证每条建议。
10. **修改与测试**：Codex 重建实现步骤并运行本地验证。
11. **回执与完成**：记录脱敏哈希和状态，通过完整闸门后才能宣布完成。

## 工作原理

### Context Packet

发送给网页端的 Packet 只包含会改变决策的信息：

- 目标；
- 验收标准；
- 相关仓库状态；
- 决定性证据；
- 约束；
- 需要推理模型回答的明确问题。

本地校验器会拒绝边界标记错误、章节缺失、字段重复、超过大小上限以及命中常见凭据模式的 Packet。

### Reasoning Result

ChatGPT 必须把证据和推断分开，并返回固定结构：结论、假设、使用的证据、建议修改、测试、风险和未知项。相同的 `packet_id` 用于绑定请求与回答。

### 本地采纳门

Result 校验通过不代表获得执行权限。Codex 必须重新打开相关文件和符号，为每个接受项补充本地证据，并自行重建命令或补丁。网页中的命令、路径、补丁和测试字符串不会被直接传给工具执行。

### 运行回执

最终回执记录：

- Packet、Result 和浏览器证据的 SHA-256；
- Codex 与 ChatGPT 模型的可见 UI 证据；
- 隐私审查字段；
- 已接受、已拒绝和延期建议；
- 本地修改与测试状态。

哈希只能绑定本地产物，不能对远端后端模型做密码学证明。

## 环境要求与支持范围

- Node.js 18 或更高版本。
- Mac 或 Windows ChatGPT 桌面 App 中的 Codex。
- Codex 内置 Browser 能力和 `browser:control-in-app-browser` Skill。
- 能在 ChatGPT 网页端实际看到目标模型的登录会话。

| 使用环境 | V1 状态 |
|---|---|
| macOS ChatGPT 桌面 App + Codex | 目标支持；已完成本地实测 |
| Windows ChatGPT 桌面 App + Codex | 目标支持；包级闸门由 Windows CI 验证 |
| Codex CLI | 不具备内置 Browser 桥接 |
| Codex IDE 扩展 | 不具备内置 Browser 桥接 |
| Linux | V1 桌面工作流不支持 |

确定性包测试同时覆盖 macOS 和 Windows。完整网页链路仍取决于用户桌面 App 版本实际开放的 Browser 能力。

## 安装

### 推荐：Skill Installer

如果当前 Codex 已提供 `$skill-installer`，直接发送：

```text
$skill-installer Install codex-bridge-chatgpt from https://github.com/anightmonarch/codex-bridge-chatgpt/tree/main/skills/codex-bridge-chatgpt
```

安装完成后新开一个 Codex 任务，让 Skill 列表重新加载。

### macOS 手动安装

```bash
git clone --depth 1 https://github.com/anightmonarch/codex-bridge-chatgpt.git
mkdir -p "$HOME/.codex/skills"
cp -R codex-bridge-chatgpt/skills/codex-bridge-chatgpt "$HOME/.codex/skills/"
```

### Windows PowerShell 手动安装

```powershell
git clone --depth 1 https://github.com/anightmonarch/codex-bridge-chatgpt.git
New-Item -ItemType Directory -Force "$HOME\.codex\skills" | Out-Null
Copy-Item -Recurse "codex-bridge-chatgpt\skills\codex-bridge-chatgpt" "$HOME\.codex\skills\"
```

如果目标目录已经存在，先备份并比较版本，不要直接覆盖。

仓库还包含已校验的 [Codex Plugin manifest](.codex-plugin/plugin.json)。Skill 目录是唯一工作流实现，Plugin 是它的分发外壳。

## 快速上手

在 Codex 中打开一个仓库，直接发送真实任务：

```text
$codex-bridge-chatgpt 找出这个间歇性故障的根因，完成最小安全修复并运行相关测试。
```

其他示例：

```text
$codex-bridge-chatgpt 审查这个架构决策，选择经过本地验证的方案并完成实现。

$codex-bridge-chatgpt 从第一性原理诊断这个性能回退并验证修复。

$codex-bridge-chatgpt 比较可能的设计，基于证据选择一个，然后修改并测试项目。
```

适合使用桥接的任务：根因不明确、存在多个可行方案、需要高成本技术判断。机械修改、简单查询和已经确定的方案应留在 Codex 本地直接完成。

## 首次运行 Doctor

用户不需要单独运行 setup。Skill 依次检查安装、持久化风险决策和当前浏览器状态：

| 状态 | 含义 | 恢复方式 |
|---|---|---|
| `NEEDS_AUTOMATION_CONSENT` | 当前没有有效的浏览器自动化风险决策 | 阅读风险说明并明确启用或拒绝 |
| `AUTOMATION_DISABLED` | 用户已经拒绝或撤销全自动桥接 | 保持本地执行，或稍后明确重新启用 |
| `READY` | 当前授权或对应预检层已经就绪 | 进入下一层预检或开始桥接 |
| `MISSING_RUNTIME` | Node.js 18+ 不可用 | 安装 Node.js 18+ 后重试 |
| `INVALID_INSTALLATION` | Skill 文件缺失或包名不匹配 | 重新安装 Skill 目录 |
| `NEEDS_DESKTOP_APP` | 当前 Codex 环境不支持桥接 | 改用 Mac/Windows ChatGPT 桌面 App |
| `NEEDS_BROWSER` | 内置 Browser 能力不可用 | 更新或启用所需 Browser 能力 |
| `NEEDS_CHATGPT_LOGIN` | 内置 Browser 中的 ChatGPT 未登录 | 接管页面登录，然后回复已登录 |
| `NEEDS_MODEL_SELECTION` | 目标模型不可见或未选中 | 选择目标模型；Skill 不会替换为其他模型 |
| `NEEDS_SITE_PERMISSION` | 访问 `chatgpt.com` 需要用户授权 | 在桌面 App 中批准访问 |

人工接管期间原仓库任务会被保留。密码、验证码、Cookie 和恢复码不能发送给 Codex。

可随时在已安装 Skill 目录撤销全自动桥接：

```bash
node scripts/automation-consent.mjs disable --json
```

## 隐私与安全

用户授权后，Skill 通过内置 Browser 的可见控件把一个最小化 Context Packet 发送到 `https://chatgpt.com/`。它不调用 ChatGPT 私有接口，不读取 Cookie、浏览器存储或隐藏认证信息，不要求 API Key，不运行托管服务，也不收集遥测。普通回执默认脱敏，网页输出在 Codex 本地重新验证前始终是不可信数据。

设计上不会主动发送：

- 密码、Token、API Key、私钥、Cookie 或验证码；
- `.env` 或原始凭据文件；
- 完整私有仓库或完整未提交 diff；
- 与任务无关的源文件；
- 未经即时确认的个人、客户、财务、医疗或组织敏感数据。

正则扫描无法理解所有业务秘密，因此发送前还必须进行语义隐私审查。

本项目不会绕过 ChatGPT 套餐、模型权限、登录、工作区策略、限额或站点安全机制，也不能把 Plus 账号变成 Pro。实际 Token 或费用节省取决于用户真实的 Codex、ChatGPT 套餐和任务类型，本 Skill 不做保证。

风险说明只能让用户知情，不能消除风险。自动提交和结果获取仍可能受到适用服务条款解释或滥用防护系统影响。

详见 [docs/privacy.md](docs/privacy.md) 和 [SECURITY.md](SECURITY.md)。

## 本地验证

项目没有 npm 第三方依赖：

```bash
npm test
npm run doctor
npm run validate
```

验证覆盖 Doctor 状态、可移植复制安装、Packet/Result 契约、敏感信息拒绝、哈希绑定、模型证据、隐私字段、完整回执和架构图资源。

## 项目结构

```text
.
├── .codex-plugin/plugin.json         # Plugin 分发清单
├── assets/                           # 中英文架构图
├── docs/                             # 安装、首次运行、隐私与设计文档
├── scripts/verify.mjs                # 可移植整包校验器
├── skills/codex-bridge-chatgpt/
│   ├── SKILL.md                      # 唯一工作流入口
│   ├── agents/openai.yaml            # Codex 界面元数据
│   ├── references/                   # 按需加载的工作流契约
│   └── scripts/                      # Doctor、授权状态与交接校验器
└── tests/                            # 单测、契约、可移植性与 E2E 产物
```

## 当前限制

- V0.2 依赖受支持的 ChatGPT 桌面 App，不是通用 CLI 桥接器。
- 登录、CAPTCHA、双因素认证、权限和模型选择仍由用户完成。
- 可见模型 UI 是可审计证据，不是远端模型的密码学证明。
- ChatGPT 页面变化可能让可见发送或复制控件无法确认；Skill 不进行 DOM 回答提取或自动重试，而是直接停止。
- 私有仓库证据在发送前可能需要用户即时确认。
- Result 即使结构合法也可能出错，本地验证不能省略。

## 开发与贡献

修改工作流行为前先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。必须保留核心边界：ChatGPT 提方案，Codex 在本地验证、修改和测试。

模型系列命名可参考 [OpenAI 官方模型指南](https://developers.openai.com/api/docs/guides/latest-model)。

## License

[MIT](LICENSE)
