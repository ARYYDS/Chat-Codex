# Migration completed

迁移批次：2026-09-05

集成开发主目录已建立为 `C:\code\Chat-Codex\handoff-core`。运行根保持为 `C:\GPT-Chat-codex-handoff`，归档根保持为 `C:\GPT-Chat-codex-handoff\PassSearchHistory`，稳定归档项目 ID 为 `GPT-Chat-codex-handoff`。

已完成：

- 复制并 SHA256 校验 186 个迁移文件；原始副本保存在 PassSearchHistory 的迁移批次目录。
- 保留两个上游独立仓库及其发布镜像，不改其 Git 历史。
- pipeline、克隆器、CDP 手动工具、合成 SQLite 测试进入 handoff-core。
- 运行根的旧 pipeline 入口转发到 handoff-core；旧实验入口标记为显式历史用途。
- 新建 `runtime.local.json`，分离 codeRoot、runtimeRoot、historyRoot、runsRoot、workersRoot、masterProfile 和 archiveProjectId。
- 归档写入采用不覆盖策略；同名不同内容生成哈希后缀副本。
- 归档导入器改为强制显式 `--input`，并固定项目层级。
- 新克隆器只允许写入 workersRoot 下的新目录，默认 DryRun 可验证路径。

验收：`node --test tests/offline/*.test.js` 通过 5/5；Node 和 PowerShell 语法检查通过；`node C:\GPT-Chat-codex-handoff\bin\handoff.js doctor --browser` 发现 9225、9222、9223 三个现有 CDP 实例；克隆 DryRun 成功。没有运行真实发送任务，也没有移动母本或活跃子实例。

Git：handoff-core 已初始化为独立本地仓库。运行配置、artifacts、profile、SQLite/DB 文件和归档数据由 `.gitignore` 排除。旧根兼容入口仍可回滚到迁移批次中的原始副本。

尚未完成的运行验收：活跃写入/断电恢复、完整原生剪贴板回收、Chrome 关闭重启后的登录保持、跨版本或跨用户迁移。它们不属于本次源码迁移的成功判据。
