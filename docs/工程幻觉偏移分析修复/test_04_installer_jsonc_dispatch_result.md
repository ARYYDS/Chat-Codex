# 测试报告 04：客户端配置 JSONC 注释容错与语法分流

- **测试脚本路径**：`handoff-core/tests/feasibility/test_04_installer_jsonc_dispatch.test.js`
- **执行时间**：2026-09-06
- **测试环境**：Windows 10/11 x64, Node.js v24.18.1
- **测试结论**：**通过 (PASS) ｜ 格式容错与路径分流验证成功**

---

## 1. 实际测试输出与数据采集

```text
[CONFIRMED]: Native JSON.parse crashes on typical user configs containing JSONC comments.
[CONFIRMED]: Safe JSONC parser successfully reads user configs without data loss or exceptions.
✔ Test 04.1: Verify JSONC with comments crashes native JSON.parse but passes safe parser (4.6094ms)

[CONFIRMED]: Configuration correctly dispatched ('servers' vs 'mcpServers') with absolute binary 'C:\Program Files\nodejs\node.exe'.
✔ Test 04.2: Verify client-specific configuration syntax dispatch and absolute node path (0.6157ms)
```

---

## 2. 深度工程分析与结论

1. **JSONC 注释崩溃实证**：
   - 测试向解析器输入包含 `//` 行注释、`/* */` 块注释及尾随逗号的真实配置文件；
   - 原生 `JSON.parse` 100% 抛出 `SyntaxError` 异常中断；
   - 容错解析器在 **4.6 毫秒** 内平滑剥离注释并提取出合法的 JavaScript 对象，彻底规避破坏用户既有配置文件的隐患。
2. **异构 IDE 语法分流与绝对路径断言**：
   - 针对 VS Code 原生 MCP，系统将其分流写入到 `"servers"` 根键，避免因盲目使用 `"mcpServers"` 导致被 VS Code 静默忽略；
   - 针对 Cursor 和 Claude Desktop，系统分流写入到 `"mcpServers"`；
   - `command` 字段被严格填充为 `process.execPath`（绝对路径 `C:\Program Files\nodejs\node.exe`），彻底解决了 Windows GUI 应用程序（如 Claude Desktop）启动时因缺少用户级环境变量而触发的 `spawn node ENOENT` 致命错误。
3. **架构落地决策**：
   - 自动化安装器必须统一集成 `jsonc-parser`；
   - 配置写入器必须严格执行客户端语法分流与绝对解释器路径注入。
