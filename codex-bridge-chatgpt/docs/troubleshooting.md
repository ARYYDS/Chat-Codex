# 故障排查

| 状态 | 含义 | 处理方式 |
|---|---|---|
| `MISSING_RUNTIME` | Node.js 版本低于 18 或不可用 | 安装 Node.js 18+，重开任务后重试 |
| `INVALID_INSTALLATION` | Skill 文件缺失或包名错误 | 重新从 GitHub 的 `skills/codex-bridge-chatgpt` 路径安装 |
| `NEEDS_AUTOMATION_CONSENT` | 没有有效的全自动桥接风险决策 | 阅读完整风险说明，明确启用或拒绝 |
| `AUTOMATION_DISABLED` | 用户已经拒绝或撤销全自动桥接 | 保持本地执行；需要时重新完成明确授权 |
| `NEEDS_DESKTOP_APP` | 当前不是支持的桌面 App Codex 环境 | 改用 Mac/Windows ChatGPT 桌面 App |
| `NEEDS_BROWSER` | 内置 Browser 或 Browser Skill 不可用 | 更新桌面 App，确认 Browser 能力启用 |
| `NEEDS_CHATGPT_LOGIN` | 内置 Browser 中的 ChatGPT 未登录 | 接管页面完成登录，然后回复“已登录” |
| `NEEDS_MODEL_SELECTION` | 请求模型不可见或未选中 | 在页面选择模型；如需降级，明确批准目标模型 |
| `NEEDS_SITE_PERMISSION` | ChatGPT 站点访问等待授权 | 在桌面 App 中允许访问 `chatgpt.com` |

## 普通 Chrome 已登录但仍要求登录

正常。内置 Browser 使用独立配置，不自动共享普通 Chrome 的 Cookie。V1 不会切换到普通 Chrome 绕过预检。

## Result 格式校验失败

Skill 会立即停止，不会把校验错误自动发回 ChatGPT，不会开始第二轮对话，也不会把不完整回答当成有效 Result。

## 模型名称无法证明

只有当前运行中可见的模型 UI 才能记录为 `verified`。回答中的模型自述、Packet 的 `requested_reasoner` 和历史截图都不能替代当前证据。

## 页面结构变化

如果登录、模型选择器、复制按钮或回答标题无法可靠识别，Skill 应明确失败并保留本地任务，不静默报告传输成功。

如果发送后无法确认是否已经提交，或点击“复制回答”后剪贴板没有变化，Skill 不会再次发送，也不会通过 DOM 抽取回答。它会保留本地任务并报告明确阻塞。
