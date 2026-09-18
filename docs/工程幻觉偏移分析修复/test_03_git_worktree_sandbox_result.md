# 测试报告 03：Git Worktree 影子沙盒物理隔离与 Windows 进程树硬熔断

- **测试脚本路径**：`handoff-core/tests/feasibility/test_03_git_worktree_sandbox_and_prockill.test.js`
- **执行时间**：2026-09-06
- **测试环境**：Windows 10/11 x64, Git 2.45+, Node.js v24.18.1
- **测试结论**：**通过 (PASS) ｜ 物理隔离与进程消灭验证成功**

---

## 1. 实际测试输出与数据采集

```text
[CONFIRMED]: Git Worktree shadow sandbox completely isolates malformed patches from active working tree.
✔ Test 03.1: Verify Git Worktree creates an isolated shadow sandbox without dirtying main workspace (898.9484ms)

[Spawned runaway loop process PID]: 18768
[Taskkill Output]: SUCCESS: The process with PID 5660 (child process of PID 18768) has been terminated.
SUCCESS: The process with PID 18768 (child process of PID 8380) has been terminated.
[CONFIRMED]: taskkill /T /F successfully hard-kills runaway process trees and prevents zombie worker file locking.
✔ Test 03.2: Verify Windows taskkill /T /F terminates runaway test processes and child process trees (1723.2653ms)
```

---

## 2. 深度工程分析与结论

1. **工作区脏污（Dirty Tree）与用户现场防护验证**：
   - 在测试中，系统派生了一个临时的独立 Worktree 分支，向影子目录中注入损坏的补丁代码与语法错误文件；
   - 检查主工作区 `git status --porcelain`：**完全保持 100% 洁净，零污染**！
   - 证明：严禁直接在用户当前目录打补丁，通过 Git Worktree 物理影子沙盒，能够彻底规避 `git apply` 失败残留 `.rej` 碎片以及盲目 `git reset --hard` 抹杀用户未保存代码的毁灭性风险。
2. **Windows 孤儿进程与死循环硬熔断实测**：
   - 测试模拟了 AI 生成的 `while(true){}` 恶意死循环逻辑，派生了进程树（父 PID 18768，子 PID 5660）；
   - 在 Windows 下使用常规 `child.kill()` 只会杀死外层壳子，子进程会沦为孤儿进程常态化占满 CPU；
   - 本次测试调用 Windows 专属 `taskkill /pid {PID} /T /F`，**成功将父子两级进程树全部彻底击杀**（成功回显 `SUCCESS: The process with PID 5660/18768 has been terminated`）；
   - 随后的 `tasklist` 校验确认没有残留任何孤儿 Node 进程，工作区文件锁被立即完整释放。
3. **架构落地决策**：
   - 生产环境门禁必须在 `sandboxes/` 目录下通过 `git worktree` 执行补丁测试；
   - 测试执行器必须封装 `taskkill /T /F` 30 秒超时看门狗。
