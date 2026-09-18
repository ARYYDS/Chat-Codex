# 首次使用

用户只需要提交一个真实任务，不需要先运行 `setup`：

```text
$codex-bridge-chatgpt 帮我定位这个复杂 Bug 的根因并完成修复
```

## 自动流程

1. 本地 Doctor 检查 Skill 文件和 Node.js。
2. Skill 检查版本化风险状态；无有效决策时返回 `NEEDS_AUTOMATION_CONSENT`。
3. Codex 明确说明这是 Unofficial Experimental 自动化，存在非零账号风险、临时限制和账号处置可能，也不保证额度永久分离。
4. 只有用户在当前对话明确同意后，Skill 才持久化启用状态。拒绝后返回 `AUTOMATION_DISABLED`，不触碰 ChatGPT。
5. 授权就绪后，Codex 检查桌面 App 和内置 Browser 能力。
6. 内置 Browser 打开或接管 `https://chatgpt.com/`。
7. 页面未登录时，Skill 返回 `NEEDS_CHATGPT_LOGIN` 并请用户接管。
8. 用户登录后回复“已登录”。Skill 重新检查浏览器状态并继续原任务。
9. 目标模型不可用时返回 `NEEDS_MODEL_SELECTION`，不会静默更换模型。
10. 所有状态为 `READY` 后才构造一个 Packet、发送一次并复制一次回答。

## 撤销全自动桥接

在已安装 Skill 目录运行：

```bash
node scripts/automation-consent.mjs disable --json
```

授权说明版本发生变化、状态损坏或状态缺失时，都会失败关闭并要求重新决策。

## 登录安全

- 登录、验证码、双因素认证和 CAPTCHA 由用户完成。
- 不要把密码、验证码、Cookie 或恢复码发到聊天中。
- Skill 不检查浏览器本地存储、Cookie 文件或密码管理器。
- Skill 不调用私有 ChatGPT 接口，不读取 session storage 或隐藏认证头。
- 登录完成后无需重新描述原任务。

## 发送前确认

公开源码或纯通用问题可以直接生成 Packet。Packet 含非公开仓库证据时，Codex 会在发送前说明目的地和数据范围，并请求即时确认。
