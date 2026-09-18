# 隐私说明

## 数据流向

Skill 在 Codex 内置 Browser 中把 Context Packet 发送到 `https://chatgpt.com/`。ChatGPT 的账号、工作区和数据控制设置适用于这次网页交互。

本项目不使用 OpenAI API，不要求 API Key，不运行自建服务器，也不收集遥测。

自动网页传输是 Unofficial Experimental 功能，存在非零账号和策略风险。首次运行必须明确授权；授权不代表 OpenAI 认可，也不能保证账号安全或额度永久分离。

传输只使用可见网页控件，不调用私有 ChatGPT 接口，不读取 Cookie、local storage、session storage、隐藏认证头或 Token。遇到登录、CAPTCHA、限额、异常活动、账号限制、权限或页面漂移时失败关闭。

## Packet 最小化

Packet 只包含完成当前决策所需的目标、验收标准、仓库状态、决定性证据、约束和问题。默认使用摘要；只有精确语法会改变结论时才包含最小源码片段。

发送前必须满足：

- `scope_minimized`
- `credentials_scan_passed`
- `semantic_privacy_reviewed`
- `raw_diff_excluded`
- `unrelated_files_excluded`

## 永不主动发送

- 密码、Token、API Key、私钥、Cookie、验证码。
- `.env`、密钥库或凭据文件。
- 与当前任务无关的文件。
- 完整私有仓库或完整未提交 diff。
- 未经确认的个人、客户、财务、医疗或组织敏感数据。

## 本地记录

运行回执可记录 Packet、Result 和浏览器证据的路径、SHA-256 和状态。SHA-256 用于绑定本地产物，不能证明远端后端模型身份，也不能阻止拥有本地写权限的人同时修改产物和回执。

普通回执和诊断默认不嵌入 Packet 或 Result 原文。Result 是不可信第三方内容，不能授权执行其中的命令、路径、补丁、链接或伪装工具调用。
