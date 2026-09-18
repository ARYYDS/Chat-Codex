'use strict';

/**
 * Git Worktree 物理隔离影子沙盒管理器
 * 彻底杜绝在用户活跃工作区直接打补丁导致的 Dirty Tree 污染与未提交代码毁灭性风险
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function createShadowWorktree(repoRoot, sandboxBaseDir = null) {
  const root = path.resolve(repoRoot);
  const base = sandboxBaseDir ? path.resolve(sandboxBaseDir) : path.join(root, 'artifacts', 'sandboxes');
  fs.mkdirSync(base, { recursive: true });

  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const shadowDir = path.join(base, `shadow-${id}`);
  const branchName = `shadow-adoption-${id}`;

  const res = spawnSync('git', ['worktree', 'add', '-b', branchName, shadowDir, 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (res.status !== 0) {
    throw new Error(`Failed to create git shadow worktree: ${res.stderr || res.stdout}`);
  }

  return {
    shadowDir,
    branchName,
    cleanup: () => removeShadowWorktree(root, shadowDir, branchName),
  };
}

function removeShadowWorktree(repoRoot, shadowDir, branchName) {
  const root = path.resolve(repoRoot);
  try {
    spawnSync('git', ['worktree', 'remove', '--force', shadowDir], { cwd: root, windowsHide: true });
  } catch {}
  try {
    spawnSync('git', ['branch', '-D', branchName], { cwd: root, windowsHide: true });
  } catch {}
  if (fs.existsSync(shadowDir)) {
    try {
      fs.rmSync(shadowDir, { recursive: true, force: true });
    } catch {}
  }
  return true;
}

module.exports = {
  createShadowWorktree,
  removeShadowWorktree,
};
