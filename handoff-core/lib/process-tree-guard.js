'use strict';

/**
 * Windows 进程树硬杀与看门狗守卫 (Process Tree Guard)
 * 彻底消灭 AI 生成代码中的 while(true) 等死循环孤儿进程，避免锁死 Windows 源代码文件句柄 (EBUSY)
 */

const { spawn, spawnSync } = require('node:child_process');

function killProcessTree(pid) {
  if (!pid) return false;
  if (process.platform === 'win32') {
    try {
      const res = spawnSync('taskkill', ['/pid', pid.toString(), '/T', '/F'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      return res.status === 0;
    } catch {
      return false;
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
      return true;
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
        return true;
      } catch {
        return false;
      }
    }
  }
}

function runWithHardTimeout(cmd, args, options = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...options, detached: false, windowsHide: true });
    let killed = false;
    let stdout = '';
    let stderr = '';

    if (child.stdout) child.stdout.on('data', d => { stdout += d.toString(); });
    if (child.stderr) child.stderr.on('data', d => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      killed = true;
      killProcessTree(child.pid);
      reject(new Error(`GATE_TIMEOUT: Command '${cmd}' exceeded hard timeout of ${timeoutMs}ms (Process tree killed).`));
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (!killed) {
        resolve({ code, stdout, stderr });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

module.exports = {
  killProcessTree,
  runWithHardTimeout,
};
